#include <WiFi.h>
#include <WebServer.h>
#include <ESP32Servo.h>
#include <HTTPClient.h>

const char* ssid = "17ThaiBinh";
const char* password = "123456789";
const char* flask_host = "192.168.1.16"; 
const int flask_port = 5000;


#define TRIG_PIN 16
#define ECHO_PIN 17
#define SERVO_PIN 32
#define LED 2
#define BUZZER_PIN 23
#define MQ2_PIN 33
#define GAS_THRESHOLD 2500 


WebServer server(80);
Servo doorServo;

long distanceThreshold = 10; // cm

void setup() {
  Serial.begin(115200);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500); Serial.print(".");
  }
  Serial.println("WiFi connected");
  Serial.println(WiFi.localIP());

  // Gửi đăng ký IP đến Flask server
  HTTPClient http;
  http.begin(String("http://") + flask_host + ":" + flask_port + "/register_esp");
  http.addHeader("Content-Type", "application/json");
  int code = http.POST("{}");
  if (code > 0) {
    Serial.println("✅ Đã đăng ký IP với Flask Server.");
  } else {
    Serial.printf("❌ Lỗi khi đăng ký IP: %s\n", http.errorToString(code).c_str());
  }
  http.end();


  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(LED, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(MQ2_PIN, INPUT);
  

  doorServo.attach(SERVO_PIN);
  doorServo.write(0); // Đóng cửa

  server.on("/unlock", HTTP_POST, []() {
    openDoor();
    server.send(200, "text/plain", "OK");
  });

  server.on("/alarm", HTTP_POST, []() {
    Serial.println("⚠️ Nhận lệnh báo động từ Flask!");
    for (int i = 0; i < 5; i++) {
      digitalWrite(BUZZER_PIN, HIGH);
      delay(200);
      digitalWrite(BUZZER_PIN, LOW);
      delay(200);
    }
    server.send(200, "text/plain", "ALARM DONE");
  });


  server.begin();
}
int lastMq2State = -1;  // Khởi tạo với giá trị không hợp lệ

void loop() {
  server.handleClient();

  int mq2State = digitalRead(MQ2_PIN);
  if (mq2State != lastMq2State) {
    Serial.printf("🌫️ Giá trị MQ2 thay đổi: %d\n", mq2State);
    lastMq2State = mq2State;
  }

  if (mq2State == LOW) {  
    Serial.println("⚠️ CẢNH BÁO: Phát hiện khí gas!");


    // Gửi POST về Flask để cảnh báo
    HTTPClient http;
    http.begin(String("http://") + flask_host + ":" + flask_port + "/gas_alert");
    http.addHeader("Content-Type", "application/json");
    http.POST("{\"gas\": true}");
    http.end();

    // Còi báo động
    digitalWrite(BUZZER_PIN, HIGH);
    delay(3000);
    digitalWrite(BUZZER_PIN, LOW);

  }


  if (detectPerson()) {
    Serial.println("🚶 Có người trước cửa...");
    
    // ⏳ Đợi 3 giây trước khi gửi POST đến Flask
    delay(3000);

    // Gửi tín hiệu đến Flask server
    HTTPClient http;
    http.begin(String("http://") + flask_host + ":" + flask_port + "/trigger_unlock");
    http.addHeader("Content-Type", "application/json");
    int code = http.POST("{}");
    if (code > 0) {
      Serial.printf("✅ Gửi thành công! Mã phản hồi: %d\n", code);
      String response = http.getString();
      Serial.println("📨 Phản hồi: " + response);
    } else {
      Serial.printf("❌ Lỗi gửi: %s\n", http.errorToString(code).c_str());
    }
    http.end();

    // Nhấp nháy LED báo hiệu
    digitalWrite(LED, HIGH); delay(100);
    digitalWrite(LED, LOW); delay(100);
  }

  delay(1000);
}



bool detectPerson() {
  digitalWrite(TRIG_PIN, LOW); delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH); delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  long duration = pulseIn(ECHO_PIN, HIGH);
  long distance = duration * 0.034 / 2;
  return (distance > 0 && distance < distanceThreshold);
}

void openDoor() {
  Serial.println("Mở cửa...");
  doorServo.write(90); // quay 90 độ mở cửa
  delay(5000); 
  Serial.println("Đóng cửa...");        // giữ cửa mở 5s
  doorServo.write(0);  // đóng lại
}
