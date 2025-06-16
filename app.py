from flask import Flask, request, jsonify, Response, render_template
import cv2
import numpy as np
from queue import Queue
from mtcnn import MTCNN
from keras_facenet import FaceNet
import module as m
from flask_cors import CORS
import threading
import requests
import time
import os
import mysql.connector
from datetime import datetime
from flask import send_file
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import gc
from flask import Flask, request
from flask_socketio import SocketIO, emit

from queue import Queue, Empty
app = Flask(__name__)
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*")  # Cho phép mọi client
## ESP32
ESP32_URL = lambda: f"http://{ESP32_IP}/unlock" if ESP32_IP else None
ESP32_URL_alarm = lambda: f"http://{ESP32_IP}/alarm" if ESP32_IP else None
ESP32_IP = None
# Khởi tạo bộ nhận diện
detector = MTCNN()
embedder = FaceNet()
hand = m.handDetector(maxHands=1)
known_embedding = None
trigger_unlock = False
last_unlock_time = 0
UNLOCK_COOLDOWN = 10  # giây
last_gas_alert_time = 0  # timestamp
face_alert = False
last_face_alert_time = 0  # thời gian phát hiện người lạ gần nhất
latest_face_alert_time = 0
latest_gas_alert_time = 0
# ==== CẤU HÌNH MYSQL ====
db_config = {
    'host': 'localhost',
    'user': 'root',
    'password': '26042002',  # 🔁 THAY BẰNG MẬT KHẨU CỦA BẠN
    'database': 'smarthome3'
}
def init_db():
    conn = mysql.connector.connect(**db_config)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS sensor_history (
            id INT AUTO_INCREMENT PRIMARY KEY,
            datetime DATETIME NOT NULL,
            temperature FLOAT,
            humidity FLOAT,
            daily_usage FLOAT,
            monthly_usage FLOAT,
            daily_cost FLOAT,
            monthly_cost FLOAT
        )
    ''')
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS alert_history (
        id INT AUTO_INCREMENT PRIMARY KEY,
        type VARCHAR(50),
        message TEXT,
        timestamp DATETIME
    )
    ''')

    conn.commit()
    cursor.close()
    conn.close()
# ==== GHI DỮ LIỆU ====
def insert_sensor_data(data):
    conn = mysql.connector.connect(**db_config)
    cursor = conn.cursor()
    query = '''
        INSERT INTO sensor_history (datetime, temperature, humidity, daily_usage, monthly_usage, daily_cost, monthly_cost)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
    '''
    values = (
        datetime.now(),
        data.get('temperature'),
        data.get('humidity'),
        data.get('daily_usage'),
        data.get('monthly_usage'),
        data.get('daily_cost'),
        data.get('monthly_cost')
    )

    try:
        cursor.execute(query, values)
        conn.commit()
        print("✅ Đã lưu dữ liệu:", data)
    except Exception as e:
        print("❌ Lỗi khi ghi dữ liệu vào MySQL:", e)
    finally:
        cursor.close()
        conn.close()
def insert_alert(type, message):
    conn = mysql.connector.connect(**db_config)
    cursor = conn.cursor()
    query = '''
        INSERT INTO alert_history (type, message, timestamp)
        VALUES (%s, %s, %s)
    '''
    values = (type, message, datetime.now())
    try:
        cursor.execute(query, values)
        conn.commit()
        print(f"✅ Ghi alert {type}: {message}")
    except Exception as e:
        print("❌ Lỗi khi ghi alert:", e)
    finally:
        cursor.close()
        conn.close()


# ==== ĐỌC DỮ LIỆU ====
def fetch_latest_sensor_data(limit=100):
    conn = mysql.connector.connect(**db_config)
    cursor = conn.cursor(dictionary=True)
    cursor.execute("SELECT * FROM sensor_history ORDER BY datetime DESC LIMIT %s", (limit,))
    rows = cursor.fetchall()
    cursor.close()
    conn.close()
    return rows

# ==== API ====
@app.route('/add_sensor_data', methods=['POST'])
def add_sensor_data():
    data = request.json
    insert_sensor_data(data)
    return jsonify(success=True)


@app.route('/get_sensor_data', methods=['GET'])
def get_sensor_data():
    return jsonify(fetch_latest_sensor_data())


# ==== LẤY DỮ LIỆU TỰ ĐỘNG TỪ HOME ASSISTANT ====

HASS_URL = "https://akglxxupsbmqkezruoy7zca8tb6ekqyb.ui.nabu.casa"
HASS_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiIxNDI1MThhMTQxYjM0N2UzYTU2YWQ4YTYxYTBkN2I1MiIsImlhdCI6MTc0NTM5MzIwOCwiZXhwIjoyMDYwNzUzMjA4fQ.y4sw2nzjpsgdldiWpE-gMBl2Oxv_N8sjHoqNJ6A7-Zo"  # 🔁 Thay bằng token thật

HEADERS = {
    "Authorization": f"Bearer {HASS_TOKEN}",
    "Content-Type": "application/json"
}

ENTITY_IDS = {
    "temperature": "sensor.atc_0582_temperature",
    "humidity": "sensor.atc_0582_humidity",
    "daily_usage": "sensor.pc05ff0642599_econ_daily_new",
    "monthly_usage": "sensor.pc05ff0642599_econ_monthly_new",
    "daily_cost": "sensor.pc05ff0642599_ecost_daily_new",
    "monthly_cost": "sensor.pc05ff0642599_ecost_monthly_new"
}


def fetch_state(entity_id):
    url = f"{HASS_URL}/api/states/{entity_id}"
    try:
        res = requests.get(url, headers=HEADERS, timeout=10)
        res.raise_for_status()
        state = res.json().get("state")
        return float(state) if state is not None else None
    except Exception as e:
        print(f"[Lỗi] Không thể lấy {entity_id}: {e}")
        return None


def background_data_collector():
    while True:
        print("🔄 Đang thu thập dữ liệu từ Home Assistant...")

        data = {
            "temperature": fetch_state(ENTITY_IDS["temperature"]),
            "humidity": fetch_state(ENTITY_IDS["humidity"]),
            "daily_usage": fetch_state(ENTITY_IDS["daily_usage"]),
            "monthly_usage": fetch_state(ENTITY_IDS["monthly_usage"]),
            "daily_cost": fetch_state(ENTITY_IDS["daily_cost"]),
            "monthly_cost": fetch_state(ENTITY_IDS["monthly_cost"])
        }

        insert_sensor_data(data)
        time.sleep(3000)  # mỗi 50 phút
# Load khuôn mặt chủ nhà
def load_known_face(folder="anh/chu_nha/"):
    global known_embedding
    embeddings = []

    for filename in os.listdir(folder):
        if filename.lower().endswith((".jpg", ".jpeg", ".png")):
            img_path = os.path.join(folder, filename)
            img = cv2.imread(img_path)
            faces = detector.detect_faces(img)
            if not faces:
                print(f"⚠️ Không tìm thấy mặt trong: {filename}")
                continue
            x, y, w, h = faces[0]['box']
            face_crop = img[y:y+h, x:x+w]
            face_crop = cv2.resize(face_crop, (160, 160))
            emb = embedder.embeddings([face_crop])[0]
            embeddings.append(emb)

    if not embeddings:
        raise Exception("❌ Không tìm thấy khuôn mặt nào trong thư mục.")

    # Tính trung bình tất cả embedding
    known_embedding = np.mean(embeddings, axis=0)
    print(f"✅ Đã nạp {len(embeddings)} khuôn mặt chủ nhà.")

load_known_face()
THRESHOLD = 0.65

@app.route('/trigger_unlock', methods=['POST'])
def trigger_unlock_face():
    global trigger_unlock
    print("🚨 ĐÃ NHẬN POST từ ESP32")
    trigger_unlock = True
    return jsonify(status="started")

@app.route('/verify_face', methods=['POST'])
def verify_face():
    file = request.files['image']
    img_array = np.frombuffer(file.read(), np.uint8)
    img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)

    faces = detector.detect_faces(img)
    if not faces:
        gc.collect()
        return jsonify(result='no_face')

    x, y, w, h = faces[0]['box']
    face_crop = img[y:y+h, x:x+w]
    face_crop = cv2.resize(face_crop, (160, 160))
    embedding = embedder.embeddings([face_crop])[0]
    dist = np.linalg.norm(embedding - known_embedding)
    
    if dist < THRESHOLD:
        # 🔓 Gửi lệnh mở cửa đến ESP32
        try:
            import requests
            requests.post(ESP32_URL, timeout=2)
            print("Đã gửi lệnh mở cửa cho ESP32.")
        except Exception as e:
            print("Lỗi gửi lệnh đến ESP32:", e)
        gc.collect()
        return jsonify(result='authorized')
    else:
        gc.collect()
        return jsonify(result='unauthorized')


@app.route('/detect_gesture', methods=['POST'])
def detect_gesture():
    """Gesture detection được tối ưu để sử dụng latest_frame từ camera loop"""
    try:
        # Kiểm tra xem có nhận file upload không
        if 'image' in request.files:
            # Sử dụng ảnh upload (như code cũ)
            file = request.files['image']
            if not file:
                gc.collect()
                return jsonify(error="No image uploaded"), 400

            img_array = np.frombuffer(file.read(), np.uint8)
            img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
            if img is None:
                gc.collect()
                return jsonify(error="Invalid image data"), 400
            
            # Resize và flip để đồng bộ
            img = cv2.resize(img, (640, 480))
            img = cv2.flip(img, 1)
            
        else:
            # Sử dụng latest_frame từ camera (tối ưu hơn)
            if latest_frame is None:
                return jsonify(error="Camera not ready"), 400
            
            img = latest_frame.copy()  # Sử dụng frame từ camera loop
        
        # Xử lý gesture detection
        img = hand.findHands(img, draw=False)
        lmList = hand.findPosition(img, draw=False)

        if lmList:
            fingers = hand.fingersUp()
            count = fingers.count(1)
            
            # Gửi kết quả qua WebSocket
            socketio.emit("gesture", {"gesture": count})
            
            # Giải phóng bộ nhớ
            del img, lmList, fingers
            gc.collect()
            return jsonify(gesture=count)
        else:
            gc.collect()
            return jsonify(gesture=-1)
            
    except Exception as e:
        print("Lỗi khi xử lý cử chỉ:", e)
        gc.collect()
        return jsonify(error=str(e)), 500

def face_unlock_loop():
    global trigger_unlock, last_unlock_time, last_face_alert_time, latest_face_alert_time
    while True:
        if trigger_unlock:
            trigger_unlock = False
            print("📡 Có người trước cửa...")

            cap = cv2.VideoCapture(0)
            if not cap.isOpened():
                print("❌ Không mở được camera.")
                continue

            # Chờ camera ổn định
            for _ in range(5):
                ret, frame = cap.read()
                time.sleep(0.1)  # đợi mỗi frame 100ms
            cap.release()

            if not ret:
                print("❌ Không chụp được frame.")
                continue

            faces = detector.detect_faces(frame)
            if not faces:
                print("🚫 Không tìm thấy khuôn mặt.")
                # 👇 Hiển thị frame kể cả khi không có mặt
                cv2.putText(frame, "KHONG TIM THAY MAT", (30, 60),
                            cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)
                print("🖼️ Đang hiển thị cửa sổ camera...")
                cv2.imshow("Face Verification", frame)
                cv2.waitKey(2000)
                cv2.destroyAllWindows()
                continue

            x, y, w, h = faces[0]['box']
            face_crop = frame[y:y+h, x:x+w]
            embedding = embedder.embeddings([face_crop])[0]
            dist = np.linalg.norm(embedding - known_embedding)

            # 👉 Hiển thị GUI
            color = (0, 255, 0) if dist < THRESHOLD else (0, 0, 255)
            label = "CHU NHA" if dist < THRESHOLD else "NGUOI LA"
            cv2.rectangle(frame, (x, y), (x+w, y+h), color, 2)
            cv2.putText(frame, label, (x, y - 10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.9, color, 2)
            cv2.imshow("Face Verification", frame)
            cv2.waitKey(2000)
            cv2.destroyAllWindows()

            if dist < THRESHOLD:
                # 💡 Kiểm tra thời gian cooldown
                current_time = time.time()
                if current_time - last_unlock_time < UNLOCK_COOLDOWN:
                    print("⏳ Chờ cooldown mở cửa...")
                    continue
                last_unlock_time = current_time

                print("✅ Khuôn mặt hợp lệ. Gửi mở cửa.")
                if ESP32_URL():
                    try:
                        requests.post(ESP32_URL(), timeout=10)
                        socketio.emit("door_opened", {"status": True})
                    except Exception as e:
                        print("⚠️ Gửi ESP32 lỗi:", e)
                else:
                    print("❌ ESP32 chưa đăng ký IP.")
            else:
                print("❌ Không đúng khuôn mặt. Gửi còi báo động.")

                current_time = time.time()
                last_face_alert_time = current_time
                latest_face_alert_time = current_time  # Thêm dòng này
                insert_alert("face", "Phát hiện người lạ trước cửa")
                socketio.emit("face_alert", {"alert": True})
                # 📧 Gửi email cảnh báo
                send_email_alert(
                    subject="⚠️ Cảnh báo: Phát hiện người lạ",
                    body="Hệ thống vừa phát hiện khuôn mặt không xác định trước cửa. Vui lòng kiểm tra dashboard hoặc camera."
                )

                # Tạo tên file theo thời gian
                timestamp = datetime.now().strftime("%H%M%S_%d%m%Y")
                save_dir = "unknown_faces"
                os.makedirs(save_dir, exist_ok=True)

                # Lưu ảnh khuôn mặt 
                face_path = os.path.join(save_dir, f"stranger_{timestamp}.jpg")
                cv2.imwrite(face_path, face_crop)
                print(f"📸 Đã lưu ảnh người lạ tại: {face_path}")
                
                #Giải phóng bộ nhớ 
                del frame, face_crop
                gc.collect()
                # Gửi yêu cầu còi về ESP32
                if ESP32_URL_alarm():
                    try:
                        requests.post(ESP32_URL_alarm(), timeout=10)
                        print("🔔 Đã gửi yêu cầu báo động đến ESP32.")
                    except Exception as e:
                        print("⚠️ Gửi còi báo động lỗi:", e)
                else:
                    print("❌ ESP32 chưa đăng ký IP.")
                


        time.sleep(0.5)
        gc.collect()  # 💡 giải phóng bộ nhớ sau mỗi lần quét
@app.route('/face_status')
def face_status():
    current_time = time.time()
    active = (current_time - latest_face_alert_time) < 30  # Tăng thời gian hiển thị lên 30 giây
    return jsonify(alert=active, last_alert_time=latest_face_alert_time)





gas_alert = False  # Cảnh báo gas toàn cục

@app.route('/gas_alert', methods=['POST'])
def handle_gas_alert():
    global last_gas_alert_time
    last_gas_alert_time = time.time()
    insert_alert("gas", "Phát hiện khí GAS bất thường")
    print("🚨 GAS ALERT RECEIVED FROM ESP32")
    send_email_alert(
        subject="⚠️ Cảnh báo khí GAS",
        body="Hệ thống phát hiện khí gas bất thường. Vui lòng kiểm tra ngay."
    )

    # Gửi WebSocket đến dashboard
    socketio.emit("gas_alert", {"gas": True})

    return jsonify(status="ok")


@app.route('/gas_status')
def get_gas_status():
    active = (time.time() - latest_gas_alert_time) < 10
    return jsonify(gas=active)


@app.route('/reset_gas', methods=['POST'])
def reset_gas():
    global gas_alert
    gas_alert = False
    print("✅ GAS alert reset.")
    return jsonify(status="reset")

@app.route('/latest_stranger_image')
def latest_stranger_image():
    folder = "unknown_faces"
    if not os.path.exists(folder):
        return "", 404

    # Lấy file mới nhất trong thư mục
    files = [f for f in os.listdir(folder) if f.endswith(".jpg")]
    if not files:
        return "", 404

    latest_file = max(files, key=lambda x: os.path.getctime(os.path.join(folder, x)))
    return send_file(os.path.join(folder, latest_file), mimetype='image/jpeg')

def send_email_alert(subject, body):
    sender_email = "haogfminh@gmail.com"
    app_password = "kfeb lqaw wwsr sdlo"  # Mật khẩu ứng dụng
    receiver_email = "haogfminh@gmail.com"

    msg = MIMEMultipart()
    msg['From'] = sender_email
    msg['To'] = receiver_email
    msg['Subject'] = subject

    msg.attach(MIMEText(body, 'plain'))

    try:
        server = smtplib.SMTP("smtp.gmail.com", 587)
        server.starttls()
        server.login(sender_email, app_password)
        server.send_message(msg)
        server.quit()
        print("📧 Đã gửi email cảnh báo.")
    except Exception as e:
        print("❌ Gửi email lỗi:", e)


@app.route('/register_esp', methods=['POST'])
def register_esp():
    global ESP32_IP
    ESP32_IP = request.remote_addr
    print(f"✅ ESP32 đã đăng ký từ IP: {ESP32_IP}")
    return jsonify(status="ok", ip=ESP32_IP)

@app.route('/get_alert_history')
def get_alert_history():
    alert_type = request.args.get("type")  # "face" hoặc "gas"
    limit = int(request.args.get("limit", 50))
    conn = mysql.connector.connect(**db_config)
    cursor = conn.cursor(dictionary=True)

    if alert_type:
        cursor.execute("SELECT * FROM alert_history WHERE type=%s ORDER BY timestamp DESC LIMIT %s", (alert_type, limit))
    else:
        cursor.execute("SELECT * FROM alert_history ORDER BY timestamp DESC LIMIT %s", (limit,))
    
    data = cursor.fetchall()
    cursor.close()
    conn.close()
    return jsonify(data)

@app.route('/get_energy_summary')
def get_energy_summary():
    conn = mysql.connector.connect(**db_config)
    cursor = conn.cursor(dictionary=True)
    cursor.execute("""
        SELECT DATE(datetime) AS day,
               ROUND(AVG(daily_usage), 2) AS `usage`,
               ROUND(AVG(daily_cost), 0) AS `cost`
        FROM sensor_history
        GROUP BY DATE(datetime)
        ORDER BY day DESC
        LIMIT 7
    """)
    result = cursor.fetchall()
    cursor.close()
    conn.close()
    return jsonify(result)

@app.route('/')
def login():
    return render_template('login.html')

@app.route('/dashboard')
def dashboard():
    return render_template('dashboard.html')

latest_frame = None
is_camera_running = True
frame_queue = Queue(maxsize=2)  # Giới hạn buffer để giảm delay
def camera_loop():
    """Camera loop được tối ưu cho cả streaming và gesture detection"""
    global latest_frame, frame_queue
    
    # Thử mở camera với các cấu hình khác nhau
    cap = None
    for i in [1, 0]:  # Thử camera 1 trước, sau đó camera 0
        cap = cv2.VideoCapture(i, cv2.CAP_DSHOW)
        if cap.isOpened():
            print(f"✅ Đã mở camera {i} thành công")
            break
    
    if not cap or not cap.isOpened():
        print("❌ Không mở được camera nào")
        return
    
    # Tối ưu cấu hình camera để giảm delay
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)   # Giảm độ phân giải
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
    cap.set(cv2.CAP_PROP_FPS, 30)            # Tăng FPS
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)      # Giảm buffer xuống 1 để tránh delay
    
    # Bỏ qua vài frame đầu để camera ổn định
    for _ in range(5):
        cap.read()
    
    print("🎥 Camera được tối ưu cho streaming và gesture detection")
    
    while is_camera_running:
        ret, frame = cap.read()
        if not ret:
            continue
            
        # Resize frame để tối ưu tốc độ
        frame = cv2.resize(frame, (640, 480))
        
        # ✅ Flip frame để đồng bộ với gesture detection
        frame = cv2.flip(frame, 1)
        
        # Cập nhật latest_frame (cho face recognition và gesture detection)
        # Sử dụng copy() để tránh conflict giữa streaming và gesture processing
        latest_frame = frame.copy()
        
        # Cập nhật frame queue cho streaming (non-blocking)
        if not frame_queue.full():
            frame_queue.put(frame.copy())  # Copy để tránh conflict
        else:
            # Nếu queue đầy, bỏ frame cũ và thêm frame mới
            try:
                frame_queue.get_nowait()
                frame_queue.put(frame.copy())
            except:
                pass
        
        time.sleep(0.01)  # Giảm delay giữa các frame
    
    cap.release()
    print("🔴 Camera đã được giải phóng")

@app.route('/video_feed')
def optimized_video_feed():
    """Video feed được tối ưu với chất lượng và tốc độ cao hơn"""
    def generate():
        while True:
            try:
                # Lấy frame từ queue với timeout
                if not frame_queue.empty():
                    frame = frame_queue.get_nowait()
                else:
                    # Nếu không có frame mới, dùng latest_frame
                    if latest_frame is not None:
                        frame = latest_frame
                    else:
                        continue
                
                # Encode với chất lượng cao hơn
                encode_param = [int(cv2.IMWRITE_JPEG_QUALITY), 85]  # Chất lượng 85%
                ret, buffer = cv2.imencode('.jpg', frame, encode_param)
                
                if not ret:
                    continue
                    
                frame_bytes = buffer.tobytes()
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n'
                       b'Content-Length: ' + str(len(frame_bytes)).encode() + b'\r\n\r\n' + 
                       frame_bytes + b'\r\n')
                
            except Exception as e:
                print(f"Lỗi trong video_feed: {e}")
                continue
                
    return Response(generate(), 
                   mimetype='multipart/x-mixed-replace; boundary=frame',
                   headers={'Cache-Control': 'no-cache, no-store, must-revalidate',
                           'Pragma': 'no-cache',
                           'Expires': '0'})

if __name__ == '__main__':
    init_db()
    # Khởi động các thread
    data_thread = threading.Thread(target=background_data_collector, daemon=True)
    data_thread.start()
    
    face_thread = threading.Thread(target=face_unlock_loop, daemon=True)
    face_thread.start()
    
    # Sử dụng camera loop được tối ưu
    camera_thread = threading.Thread(target=camera_loop)
    camera_thread.daemon = True
    camera_thread.start()
    
    print("🚀 Tất cả services đã được khởi động")
    socketio.run(app, host='0.0.0.0', port=5000, debug=False)
