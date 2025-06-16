# 🏠 Smart Home Project

Hệ thống Nhà Thông Minh tích hợp nhiều công nghệ như nhận diện khuôn mặt, điều khiển thiết bị từ xa, cảm biến môi trường và giao diện điều khiển realtime. Đây là dự án đồ án tốt nghiệp nhằm mô phỏng, triển khai và đánh giá giải pháp nhà thông minh tiết kiệm chi phí nhưng hiệu quả.

## 📌 Tính năng chính

- ✅ **Nhận diện khuôn mặt mở cửa tự động**
- ✅ **Cảnh báo khi phát hiện người lạ**
- ✅ **Điều khiển thiết bị qua dashboard realtime**
- ✅ **Phát hiện chuyển động bằng cảm biến siêu âm**
- ✅ **Giám sát nhiệt độ - độ ẩm bằng cảm biến BLE**
- ✅ **Giao tiếp với ESP32 qua API/HTTP hoặc Bluetooth**
- ✅ **Thông báo lên dashboard khi có sự kiện bất thường**
- ✅ **Điều khiển thiết bị bằng nhận diện cử chỉ tay (AI)**

## 🖥️ Giao diện điều khiển

Dashboard Web UI được xây dựng bằng:
- `Flask` (Python backend)
- `Flask-SocketIO` để gửi dữ liệu realtime đến client
- `HTML / CSS / JavaScript` cho frontend
- `Bootstrap` để responsive

## 🔌 Phần cứng sử dụng

| Thiết bị                    | Chức năng                                     |
|-------------------------    |-----------------------------------------------|
| Máy tính / Laptop           | Chạy backend Flask và Home Assistant          |
| NodeMCU-32S (ESP32)         | Điều khiển, giao tiếp cảm biến      |
| Cảm biến HC-SR04            | Phát hiện người đến gần                       |
| Cảm biến MQ2                | Phát hiện khói / khí gas                      |
| Nhiệt ẩm kế Xiaomi BLE      | Theo dõi nhiệt độ – độ ẩm môi trường          |
| Camera                      | Nhận diện khuôn mặt / cử chỉ bằng OpenCV      |
| Đèn Yeelight + Đèn Ezviz    | Thiết bị thông minh điều khiển trong nhà      |
| LM2596 Power Module         | Hạ áp, cấp nguồn ổn định cho mạch             |

## 🧠 AI & Xử lý hình ảnh

- Nhận diện khuôn mặt sử dụng `FaceNet` và `MTCNN`
- Nhận diện tay/cử chỉ với `MediaPipe`
- Phát hiện người trước cửa bằng kết hợp **HC-SR04 + Camera**

## 🔧 Cài đặt & Chạy dự án

### 1. Cài đặt thư viện Python
```bash
pip install -r requirements.txt
```

### 2. Chạy backend Flask
```bash
python app.py
```

### 3. Truy cập dashboard:
```
https://smarthome.smarthomediy.click
```

## 📁 Cấu trúc thư mục

```
smart-home-project/
├── app.py
├── static/
│   └── js, css, img
├── templates/
│   └── login.html, dashboard.html
├── esp_api/
├── requirements.txt
└── README.md
```

## 🚀 Mục tiêu triển khai

- [x] Mô phỏng mở cửa thông minh
- [x] Tự động hóa qua cảm biến và AI
- [x] Dashboard điều khiển toàn bộ hệ thống


## 👨‍💻 Tác giả

- **Minh Hoàng, Phan Quốc** – Bách Khoa Đà Nẵng  
- Email: minhka1216@gmail.com  
- GitHub: [@minh838699](https://github.com/minh838699)

---

## 📜 Giấy phép

Dự án mang tính học thuật, phi thương mại. Mọi quyền tác giả thuộc về nhóm sinh viên thực hiện.
