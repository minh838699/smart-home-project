let countdownInterval = null;
    let gestureInterval = null;
    let countdownTimeLeft = 0;

    function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const isMobile = window.innerWidth <= 768;

    if (isMobile) {
        // Trên màn hình nhỏ, hiển thị/ẩn sidebar bằng class .active
        sidebar.classList.toggle('active');
    } else {
        // Trên desktop, sử dụng chế độ thu gọn mở rộng
        const isCollapsed = sidebar.classList.toggle('collapsed');
        document.querySelectorAll('.container').forEach(container => {
            container.classList.toggle('shifted', isCollapsed);
        });
    }
}




    const CONFIG = {
        hassUrl: "https://akglxxupsbmqkezruoy7zca8tb6ekqyb.ui.nabu.casa",
        hassToken: localStorage.getItem("hassToken"),
        entityIds: {
            livingRoomLight: "light.192_168_1_18",
            bedroomLight: "input_boolean.den_2",
            temperatureSensor: "sensor.atc_0582_temperature",
            humiditySensor: "sensor.atc_0582_humidity",

            // Energy IDs
            energyStart: "sensor.pc05ff0642599_econ_total_old",
            energyCurrent: "sensor.pc05ff0642599_econ_total_new",
            oldBill: "sensor.pc05ff0642599_payment_needed",
            lastUpdate: "sensor.pc05ff0642599_latest_update",
            cutSchedule: "sensor.pc05ff0642599_loadshedding",
            startDay: "sensor.pc05ff0642599_from_date",
            endDay: "sensor.pc05ff0642599_to_date",
            dailyUsage1: "sensor.pc05ff0642599_econ_daily_old",
            dailyUsage2: "sensor.pc05ff0642599_econ_daily_new",
            monthlyUsage: "sensor.pc05ff0642599_econ_monthly_new",
            dailyCost1: "sensor.pc05ff0642599_ecost_daily_old",
            dailyCost2: "sensor.pc05ff0642599_ecost_daily_new",
            monthlyCost: "sensor.pc05ff0642599_ecost_monthly_new",
            debt: "sensor.pc05ff0642599_m_payment_needed"
        }
    };

    if (!CONFIG.hassToken) {
        alert("Không tìm thấy token! Vui lòng quay lại trang chính để nhập token.");
        window.location.href = "login.html";
    }
  // === KẾT THÚC CẤU HÌNH ===

        // Biến toàn cục
        let hassConnection = null;
        let connectionRetryCount = 0;
        let messageId = 1;
        let stateCallbacks = {};
        let entityStates = {};
        let reconnectInterval = null;

        // Các phần tử DOM
        const elements = {
            livingRoomLight: document.getElementById("livingRoomLight"),
            livingRoomBrightness: document.getElementById("livingRoomBrightness"),
            brightnessValue: document.getElementById("brightnessValue"),
            bedroomLight: document.getElementById("bedroomLight"),
            bedroomBrightness: document.getElementById("bedroomBrightness"),
            bedroomBrightnessValue: document.getElementById("bedroomBrightnessValue"),
            temperatureValue: document.getElementById("temperatureValue"),
            tempLastUpdate: document.getElementById("tempLastUpdate"),
            humidityValue: document.getElementById("humidityValue"),
            humidityLastUpdate: document.getElementById("humidityLastUpdate"),
            connectionStatus: document.getElementById("connectionStatus"),
            connectionText: document.getElementById("connectionText"),
            lastUpdated: document.getElementById("lastUpdated"),
            connectionErrorMsg: document.getElementById("connectionErrorMsg"),
            lightErrorMsg: document.getElementById("lightErrorMsg")
        };

        // Khởi tạo kết nối WebSocket với Home Assistant
        function connectToHomeAssistant() {
            try {
                updateConnectionStatus(false, "Đang kết nối với Máy chủ...");
                
                const url = `${CONFIG.hassUrl.replace('http://', 'ws://').replace('https://', 'wss://')}/api/websocket`;
                const socket = new WebSocket(url);
                
                socket.onopen = () => {
                    console.log('WebSocket đã kết nối, đang xác thực...');
                    connectionRetryCount = 0;
                    clearInterval(reconnectInterval);
                };
                
                socket.onmessage = (event) => {
                    const data = JSON.parse(event.data);
                    handleMessage(data, socket);
                };
                
                socket.onclose = (event) => {
                    console.log('WebSocket bị ngắt kết nối', event);
                    updateConnectionStatus(false, "Mất kết nối với Máy chủ");
                    updateConnectionStatus(false, "Mất kết nối với Máy chủ. Đang thử kết nối lại...");
                    
                    // Thử kết nối lại sau 5 giây
                    if (!reconnectInterval) {
                        reconnectInterval = setInterval(() => {
                            connectionRetryCount++;
                            if (connectionRetryCount < 10) {
                                connectToHomeAssistant();
                            } else {
                                clearInterval(reconnectInterval);
                                reconnectInterval = null;
                                updateConnectionStatus(false, "Không thể kết nối lại với Máy chủ sau nhiều lần thử. Vui lòng kiểm tra kết nối và làm mới trang.");

                            }
                        }, 5000);
                    }
                };
                
                socket.onerror = (error) => {
                    console.error("Lỗi WebSocket:", error);
                    updateConnectionStatus(false, "Lỗi kết nối với Home Assistant. Vui lòng kiểm tra kết nối mạng.");
                };
                
                hassConnection = socket;
            } catch (error) {
                console.error("Lỗi khi tạo kết nối:", error);
                showError("connectionErrorMsg", "Lỗi khi tạo kết nối: " + error.message);
                
                // Thử kết nối lại sau 5 giây
                setTimeout(connectToHomeAssistant, 5000);
            }
        }

        // Xử lý tin nhắn từ Home Assistant
        function handleMessage(message, socket) {
            console.log('Nhận tin nhắn:', message);
            
            switch (message.type) {
                case 'auth_required':
                    // Gửi token xác thực
                    socket.send(JSON.stringify({
                        type: 'auth',
                        access_token: CONFIG.hassToken
                    }));
                    break;
                    
                case 'auth_ok':
                    // Xác thực thành công
                    console.log('Xác thực thành công với Home Assistant');
                    updateConnectionStatus(true, "Đã kết nối với Máy chủ");
                    hideError("connectionErrorMsg");
                    
                    // Đăng ký lắng nghe sự kiện thay đổi trạng thái
                    subscribeToEvents(socket);
                    
                    // Lấy trạng thái hiện tại của các thiết bị
                    getStates(socket);
                    break;
                    
                case 'auth_invalid':
                    // Xác thực thất bại
                    console.error('Xác thực thất bại:', message.message);
                    updateConnectionStatus(false, "Xác thực thất bại: Token không hợp lệ hoặc đã hết hạn.");
                    updateConnectionStatus(false, "Lỗi xác thực");
                    break;
                    
                case 'event':
                    // Xử lý sự kiện
                    if (message.event && message.event.event_type === 'state_changed') {
                        handleStateChanged(message.event.data);
                    }
                    break;
                    
                case 'result':
                    // Xử lý kết quả từ API call
                    if (message.id && stateCallbacks[message.id]) {
                        stateCallbacks[message.id](message.result);
                        delete stateCallbacks[message.id];
                    }
                    break;
                    
                default:
                    // Xử lý các loại tin nhắn khác nếu cần
                    break;
            }
        }

        // Đăng ký lắng nghe sự kiện thay đổi trạng thái
        function subscribeToEvents(socket) {
            const id = messageId++;
            socket.send(JSON.stringify({
                id: id,
                type: 'subscribe_events',
                event_type: 'state_changed'
            }));
        }

        // Lấy trạng thái của tất cả các thiết bị
        function getStates(socket) {
            const id = messageId++;
            stateCallbacks[id] = (states) => {
                if (Array.isArray(states)) {
                    // Lưu trạng thái của tất cả thiết bị
                    states.forEach(state => {
                        entityStates[state.entity_id] = state;
                    });
                    
                    // Cập nhật UI cho các thiết bị quan tâm
                    updateDeviceStates();
                    updateFullEnergyInfo();
                }
            };
            
            socket.send(JSON.stringify({
                id: id,
                type: 'get_states'
            }));
        }

        // Xử lý sự kiện thay đổi trạng thái
        function handleStateChanged(data) {
            const { entity_id, new_state } = data;
            
            // Lưu trạng thái mới của thiết bị
            if (new_state) {
                entityStates[entity_id] = new_state;
                
                // Cập nhật UI cho thiết bị cụ thể nếu đó là thiết bị chúng ta quan tâm
                updateDeviceState(entity_id);
                
                // Cập nhật thời gian cập nhật cuối cùng
                updateLastUpdated();
                updateFullEnergyInfo();
            }
        }

        // Cập nhật UI cho tất cả các thiết bị quan tâm
        function updateDeviceStates() {
            const { entityIds } = CONFIG;
            
            // Cập nhật trạng thái đèn phòng khách
            updateDeviceState(entityIds.livingRoomLight);
            
            // Cập nhật trạng thái đèn phòng ngủ
            updateDeviceState(entityIds.bedroomLight);
            
            // Cập nhật giá trị nhiệt độ
            updateDeviceState(entityIds.temperatureSensor);
            
            // Cập nhật giá trị độ ẩm
            updateDeviceState(entityIds.humiditySensor);
            
            // Cập nhật thời gian cập nhật cuối cùng
            updateLastUpdated();
            updateFullEnergyInfo();
        }

        // Cập nhật UI cho một thiết bị cụ thể
        function updateDeviceState(entity_id) {
            const state = entityStates[entity_id];
            if (!state) return;
            
            const { entityIds } = CONFIG;
            
            switch (entity_id) {
                case entityIds.livingRoomLight:
                    // Cập nhật trạng thái đèn phòng khách
                    const isLivingRoomOn = state.state === 'on';
                    elements.livingRoomLight.checked = isLivingRoomOn;
                    
                    // Cập nhật độ sáng nếu có
                    if (isLivingRoomOn && state.attributes && state.attributes.brightness) {
                        const brightness = Math.round((state.attributes.brightness / 255) * 100);
                        elements.livingRoomBrightness.value = brightness;
                        elements.brightnessValue.textContent = brightness;
                    }
                    break;
                    
                case entityIds.bedroomLight:
                    // Cập nhật trạng thái đèn phòng ngủ
                    const isBedroomOn = state.state === 'on';
                    elements.bedroomLight.checked = isBedroomOn;
                    
                    // Cập nhật độ sáng nếu có
                    if (isBedroomOn && state.attributes && state.attributes.brightness) {
                        const brightness = Math.round((state.attributes.brightness / 255) * 100);
                        elements.bedroomBrightness.value = brightness;
                        elements.bedroomBrightnessValue.textContent = brightness;
                    }
                    break;
                    
                    case entityIds.temperatureSensor:
                        elements.temperatureValue.textContent = `${state.state}°C`;
                        if (elements.tempLastUpdate) {  // kiểm tra tồn tại
                            elements.tempLastUpdate.textContent = formatTime(state.last_updated);
                        }
                        break;

                    
                        case entityIds.humiditySensor:
                            elements.humidityValue.textContent = `${state.state}%`;
                            if (elements.humidityLastUpdate) {
                                elements.humidityLastUpdate.textContent = formatTime(state.last_updated);
                            }
                            break;

                    
                default:
                    // Thiết bị không quan tâm
                    break;
            }
        }

        // Bật/tắt đèn
        function toggleLight(entityId, state) {
            
            if (!hassConnection || hassConnection.readyState !== WebSocket.OPEN) {
                showError("lightErrorMsg", "Không thể điều khiển đèn: Mất kết nối với Máy chủ");
                return;
            }
            
            const service = state ? "turn_on" : "turn_off";
            const id = messageId++;
            const domain = entityId.startsWith('light.') ? 'light' : 
                  entityId.startsWith('input_boolean.') ? 'input_boolean' : 
                  'light'; // mặc định
            hassConnection.send(JSON.stringify({
                id: id,
                type: "call_service",
                domain: domain,
                service: service,
                service_data: {
                    entity_id: entityId
                }
            }));
            
            hideError("lightErrorMsg");
        }

        // Điều chỉnh độ sáng đèn
        function setBrightness(entityId, brightness) {
            
            if (!hassConnection || hassConnection.readyState !== WebSocket.OPEN) {
                showError("lightErrorMsg", "Không thể điều chỉnh độ sáng: Mất kết nối với Máy chủ");
                return;
            }
            
            // Chuyển đổi phần trăm độ sáng (0-100) sang giá trị brightness của HA (0-255)
            const brightnessValue = Math.round((brightness / 100) * 255);
            const id = messageId++;
            
            hassConnection.send(JSON.stringify({
                id: id,
                type: "call_service",
                domain: "light",
                service: "turn_on",
                service_data: {
                    entity_id: entityId,
                    brightness: brightnessValue
                }
            }));

            hassConnection.send(JSON.stringify({
                id: id,
                type: "call_service",
                domain: "input_boolean",
                service: "turn_on",
                service_data: {
                    entity_id: entityId,
                    brightness: brightnessValue
                }
            }));
            
            hideError("lightErrorMsg");
        }

        // Thiết lập các sự kiện cho các phần tử điều khiển
        function setupEventListeners() {
            const { entityIds } = CONFIG;
            
            // Bật/tắt đèn phòng khách
            elements.livingRoomLight.addEventListener("change", function() {
                toggleLight(entityIds.livingRoomLight, this.checked);
            });
            
            // Điều chỉnh độ sáng đèn phòng khách
            elements.livingRoomBrightness.addEventListener("change", function() {
                setBrightness(entityIds.livingRoomLight, parseInt(this.value));
            });
            
            // Cập nhật giá trị độ sáng khi kéo thanh trượt
            elements.livingRoomBrightness.addEventListener("input", function() {
                elements.brightnessValue.textContent = this.value;
            });
            
            // Bật/tắt đèn phòng ngủ
            elements.bedroomLight.addEventListener("change", function() {
                toggleLight(entityIds.bedroomLight, this.checked);
            });
            
            // Điều chỉnh độ sáng đèn phòng ngủ
            elements.bedroomBrightness.addEventListener("change", function() {
                setBrightness(entityIds.bedroomLight, parseInt(this.value));
            });
            
            // Cập nhật giá trị độ sáng khi kéo thanh trượt
            elements.bedroomBrightness.addEventListener("input", function() {
                elements.bedroomBrightnessValue.textContent = this.value;
            });
        }

        // Cập nhật trạng thái kết nối UI
        function updateConnectionStatus(isConnected, message) {
            if (isConnected) {
                elements.connectionStatus.className = "indicator connected";
                elements.connectionText.textContent = message || "Đã kết nối với Máy chủ";
            } else {
                elements.connectionStatus.className = "indicator disconnected";
                elements.connectionText.textContent = message || "Mất kết nối với Máy chủ";
            }
        }

        // Định dạng thời gian từ chuỗi ISO
        function formatTime(isoString) {
            const date = new Date(isoString);
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        }

        // Cập nhật thời gian cập nhật cuối cùng
        function updateLastUpdated() {
            const now = new Date();
            const formattedDate = now.toLocaleDateString('vi-VN');
            const formattedTime = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            elements.lastUpdated.textContent = `Cập nhật lần cuối: ${formattedDate} ${formattedTime}`;
        }

        // Hiện thông báo lỗi
        function showError(elementId, message) {
            const errorElement = document.getElementById(elementId);
            if (errorElement) {
                errorElement.textContent = message;
                errorElement.style.display = "block";
            }
        }

        // Ẩn thông báo lỗi
        function hideError(elementId) {
            const errorElement = document.getElementById(elementId);
            if (errorElement) {
                errorElement.style.display = "none";
            }
        }
            const gestureCam = document.getElementById("gestureCamera");

            navigator.mediaDevices.getUserMedia({ video: true }).then(stream => {
                gestureCam.srcObject = stream;
                window._gestureStream = stream;  // có thể dùng lại trong captureFrame()
            });

        // Khởi chạy ứng dụng
        window.addEventListener("DOMContentLoaded", () => {
            setupEventListeners();
            connectToHomeAssistant();
            gestureInterval = setInterval(() => {
                detectGesture();
            }, 2000);  // mỗi 3 giây
        });
        function switchTab(tabName, element) {
            // Ẩn/hiện nội dung các tab
            document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
            document.getElementById(tabName + 'Tab').classList.add('active');

            // Cập nhật trạng thái sidebar
            document.querySelectorAll('.sidebar a').forEach(link => link.classList.remove('active'));
            if (element) element.classList.add('active');

            // Cập nhật tiêu đề
            const pageTitle = document.getElementById('pageTitle');
            const tabTitles = {
                overview: "Tổng quan",
                energy: "Năng lượng",
                history: "Lịch sử"
            };
            if (pageTitle) pageTitle.textContent = tabTitles[tabName] || "Dashboard";

            // 💥 Nếu chuyển sang tab năng lượng => cập nhật lại dữ liệu năng lượng
            if (tabName === 'energy') {
                updateFullEnergyInfo();
            }
            if (tabName === 'history') {
            switchHistoryView(document.getElementById("historyType").value);
            }
        }


        const tempCtx = document.getElementById('temperatureChart').getContext('2d');
            const tempGradient = tempCtx.createLinearGradient(0, 0, 0, 200);
            tempGradient.addColorStop(0, 'rgba(255, 99, 132, 0.4)');
            tempGradient.addColorStop(1, 'rgba(255, 99, 132, 0)');

            const temperatureChart = new Chart(tempCtx, {
            type: 'line',
            data: {
                datasets: [{
                label: 'Nhiệt độ (°C)',
                data: [],
                borderColor: 'rgba(255, 99, 132, 1)',
                backgroundColor: tempGradient,  // gradient fill
                borderWidth: 2,
                fill: true,                     // 💡 bật fill
                tension: 0.3,
                pointBackgroundColor: '#fff',
                pointBorderColor: 'rgba(255, 99, 132, 1)',
                pointRadius: 4
                }]
            },
            options: {
                responsive: true,
                animation: false,
                scales: {
                    x: {
                        type: 'time',  // 🔥 bắt buộc để dùng thời gian
                        time: {
                            unit: 'minute',
                            tooltipFormat: 'HH:mm:ss dd-MM-yyyy',
                            displayFormats: {
                            minute: 'HH:mm'
                            }
                        },
                        title: {
                            display: true,
                            text: 'Thời gian'
                        },
                        ticks: {
                            autoSkip: true,
                            maxRotation: 0,
                            minRotation: 0,
                            major: { enabled: true }
                        }
                    },

                    y: {
                    beginAtZero: true,
                    title: { display: true, text: '°C' }
                    }
                }
            }
        });


        const humidCtx = document.getElementById('humidityChart').getContext('2d');
        const humidGradient = humidCtx.createLinearGradient(0, 0, 0, 200);
        humidGradient.addColorStop(0, 'rgba(54, 162, 235, 0.4)');
        humidGradient.addColorStop(1, 'rgba(54, 162, 235, 0)');

        const humidityChart = new Chart(humidCtx, {
                type: 'line',
                data: {
                    datasets: [{
                        label: 'Độ ẩm (%)',
                        data: [],
                        borderColor: 'rgba(54, 162, 235, 1)',
                        backgroundColor: humidGradient,
                        borderWidth: 2,
                        fill: true,
                        tension: 0.3,
                        pointBackgroundColor: '#fff',
                        pointBorderColor: 'rgba(54, 162, 235, 1)',
                        pointRadius: 4
                    }]
                },
            options: {
                responsive: true,
                animation: false,
                scales: {
                    x: {
                        type: 'time',  // 🔥 bắt buộc để dùng thời gian
                        time: {
                            unit: 'minute',
                            tooltipFormat: 'HH:mm:ss dd-MM-yyyy',
                            displayFormats: {
                            minute: 'HH:mm'
                            }
                        },
                        title: {
                            display: true,
                            text: 'Thời gian'
                        },
                        ticks: {
                            autoSkip: true,
                            maxRotation: 0,
                            minRotation: 0,
                            major: { enabled: true }
                        }
                    } ,  

                    y: {
                        beginAtZero: true,
                        title: { display: true, text: '%' }
                    }
                }
            }
        });


        function updateChartsFromState(entity_id, value) {
            const now = Date.now();  // timestamp cho trục thời gian

            const chart = entity_id.includes('temperature') ? temperatureChart : humidityChart;
            const parsedValue = parseFloat(value);

            if (chart.data.datasets[0].data.length >= 8) {
                chart.data.datasets[0].data.shift();  // giữ 8 điểm
            }

            chart.data.datasets[0].data.push({ x: now, y: parsedValue });
            chart.update();
        }

        // Gọi trong updateDeviceState để cập nhật biểu đồ
        const originalUpdateDeviceState = updateDeviceState;
        updateDeviceState = function(entity_id) {
            originalUpdateDeviceState(entity_id);
            const state = entityStates[entity_id];
            if (!state) return;

            if (entity_id === CONFIG.entityIds.temperatureSensor || entity_id === CONFIG.entityIds.humiditySensor) {
                updateChartsFromState(entity_id, state.state);
            }
        };
        
        
        const toggle = document.getElementById('darkModeToggle');
        const themeIcon = document.getElementById('themeIcon');
        const themeLabel = document.getElementById('themeLabel');

        function setThemeMode(isDark) {
            document.body.classList.toggle('dark-mode', isDark);
            localStorage.setItem('theme', isDark ? 'dark' : 'light');
            themeIcon.textContent = isDark ? '☀️' : '🌙';
            themeLabel.textContent = isDark ? 'Light Mode' : 'Dark Mode';
        }

        // Khi trang tải, kiểm tra localStorage
        setThemeMode(localStorage.getItem('theme') === 'dark');

        toggle.addEventListener('click', () => {
            const isDark = !document.body.classList.contains('dark-mode');
            setThemeMode(isDark);
        });
        const modal = document.getElementById('scheduleModal');
        const closeButton = modal.querySelector('.close-button');
        const scheduleEntity = document.getElementById('scheduleEntity');
        const timerEntity = document.getElementById('timerEntity');

        // Khi click vào tên đèn
        document.querySelectorAll('.light-name').forEach(el => {
            el.addEventListener('click', () => {
                const entity = el.getAttribute('data-entity');
                document.getElementById('scheduleEntity').value = entity;
                document.getElementById('timerEntity').value = entity;

                // Cập nhật tiêu đề để biết rõ đang thao tác đèn nào
                document.getElementById('modalTitle').textContent = "Cài đặt: " + el.textContent.trim();

                modal.style.display = 'flex';
            });
        });


        closeButton.addEventListener('click', () => modal.style.display = 'none');

        function switchTabContent(tabId) {
            ['scheduleTab', 'timerTab', 'deleteTab'].forEach(id => {
                document.getElementById(id).style.display = id === tabId ? 'block' : 'none';
            });
        }


        // Gửi form lên lịch
        document.getElementById('scheduleForm').addEventListener('submit', e => {
        e.preventDefault();
        const form = e.target;
        const alias = form.alias.value;
        const time = form.time.value;
        const action = form.action.value;
        const entity_id = form.entity_id.value;

        const automation = {
            alias,
            trigger: [{ platform: 'time', at: time }],
            action: [{ service: `homeassistant.${action}`, target: { entity_id } }],
            mode: 'single'
        };

        hassConnection.send(JSON.stringify({
            id: Date.now(),
            type: 'config/automation/create',
            automation
        }));

        alert('Đã gửi yêu cầu tạo lịch trình!');
        modal.style.display = 'none';
        });

        // Gửi form hẹn giờ
        document.getElementById('timerForm').addEventListener('submit', e => {
            e.preventDefault();
            const form = e.target;
            const minutes = parseInt(form.minutes.value);
            const entity_id = form.entity_id.value;

            if (minutes <= 0) {
                alert("Vui lòng nhập số phút hợp lệ.");
                return;
            }

            countdownTimeLeft = minutes * 60; // chuyển thành giây
            startCountdown(); // bắt đầu đếm ngược

            const targetEntity = entity_id;  // Đóng băng giá trị entity_id tại thời điểm này

            setTimeout(() => {
                hassConnection.send(JSON.stringify({
                    id: Date.now(),
                    type: "call_service",
                    domain: "homeassistant",
                    service: "turn_off",
                    service_data: {
                        entity_id: targetEntity
                    }
                }));
            }, minutes * 60 * 1000);



            alert('Đã hẹn giờ tắt sau ' + minutes + ' phút');
            modal.style.display = 'none';
        });

        function startCountdown() {
            clearInterval(countdownInterval);
            const countdownDisplay = document.getElementById('countdownDisplay');
            const cancelButton = document.getElementById('cancelTimerButton');

            cancelButton.style.display = 'inline-block';
            updateCountdownUI();

            countdownInterval = setInterval(() => {
                countdownTimeLeft--;
                updateCountdownUI();

                if (countdownTimeLeft <= 0) {
                clearInterval(countdownInterval);
                countdownDisplay.textContent = 'Đã hết giờ!';
                cancelButton.style.display = 'none';
                }
            }, 1000);
            }

            function updateCountdownUI() {
            const minutes = Math.floor(countdownTimeLeft / 60);
            const seconds = countdownTimeLeft % 60;
            document.getElementById('countdownDisplay').textContent = `Còn lại: ${minutes}:${seconds.toString().padStart(2, '0')}`;
            }

            document.getElementById('cancelTimerButton').addEventListener('click', () => {
                clearInterval(countdownInterval);
                document.getElementById('countdownDisplay').textContent = 'Đã huỷ hẹn giờ.';
                document.getElementById('cancelTimerButton').style.display = 'none';
                });


                function updateFullEnergyInfo() {
                    const { entityIds } = CONFIG;

                    document.getElementById('startIndex').textContent = entityStates[entityIds.energyStart]?.state + " kWh" || "--";
                    document.getElementById('currentIndex').textContent = entityStates[entityIds.energyCurrent]?.state + " kWh" || "--";
                    document.getElementById('oldBill').textContent = entityStates[entityIds.oldBill]?.state || "--";
                    document.getElementById('lastUpdate').textContent = entityStates[entityIds.lastUpdate]?.state || "--";
                    document.getElementById('cutSchedule').textContent = entityStates[entityIds.cutSchedule]?.state || "--";
                    document.getElementById('startDay').textContent = entityStates[entityIds.startDay]?.state || "--";
                    document.getElementById('endDay').textContent = entityStates[entityIds.endDay]?.state || "--";
                    document.getElementById('dailyUsage1').textContent = entityStates[entityIds.dailyUsage1]?.state + " kWh" || "--";
                    document.getElementById('dailyUsage2').textContent = entityStates[entityIds.dailyUsage2]?.state + " kWh" || "--";
                    document.getElementById('monthlyUsage').textContent = entityStates[entityIds.monthlyUsage]?.state + " kWh" || "--";
                    document.getElementById('dailyCost1').textContent = entityStates[entityIds.dailyCost1]?.state + " VNĐ" || "--";
                    document.getElementById('dailyCost2').textContent = entityStates[entityIds.dailyCost2]?.state + " VNĐ" || "--";
                    document.getElementById('monthlyCost').textContent = entityStates[entityIds.monthlyCost]?.state + " VNĐ" || "--";
                    document.getElementById('debt').textContent = entityStates[entityIds.debt]?.state + " VNĐ" || "--";
                }

                const video = document.createElement('video');
                    video.autoplay = true;
                    video.style.display = 'none';
                    document.body.appendChild(video);
                    navigator.mediaDevices.getUserMedia({ video: true }).then(stream => {
                        video.srcObject = stream;
                    });

                    // Chụp ảnh
function captureFrame(callback) {
    if (!video.videoWidth || !video.videoHeight) {
        console.warn("❌ Video chưa sẵn sàng để chụp ảnh");
        return callback(null);  // Trả về null để báo lỗi ở hàm detectGesture
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);

    canvas.toBlob(blob => {
        if (!blob) {
            console.error("❌ Không tạo được blob từ canvas.");
            callback(null);
        } else {
            callback(blob);
        }
    }, 'image/jpeg', 0.8);
}



                    let isDetecting = false;

                    function detectGesture() {
                        if (isDetecting) return;  // tránh chạy trùng
                        isDetecting = true;

                        captureFrame(blob => {
                            const formData = new FormData();
                            formData.append('image', blob);

                            fetch('/detect_gesture', {
                                method: 'POST',
                                body: formData
                            }).then(res => res.json()).then(data => {
                                const gesture = data.gesture;
                                if (gesture === 1) toggleLight("light.192_168_1_18", true);  // 1 ngón → Bật đèn 1
                                if (gesture === 2) toggleLight("light.192_168_1_18", false); // 2 ngón → Tắt đèn 1
                                if (gesture === 3) toggleLight("input_boolean.den_2", true);   // 3 ngón → Bật đèn 2
                                if (gesture === 4) toggleLight("input_boolean.den_2", false);   // 4 ngón → Bật đèn 2
                                if (gesture === 5) {                                             // 5 ngón → Tắt cả 2 đèn
                                    toggleLight("light.192_168_1_18", false);
                                    toggleLight("input_boolean.den_2", false);
                                }                                
                            }).finally(() => {
                                isDetecting = false;
                            });
                        });
                    }

let gasAlertShown = false;

function showGasPopup() {
  const popup = document.getElementById('gas-popup');
  popup.style.display = 'block';

  setTimeout(() => {
    popup.style.display = 'none';
  }, 5000);  // tự ẩn sau 5 giây
}



function checkGasStatus() {
  fetch('/gas_status')
    .then(res => res.json())
    .then(data => {
      const isGas = data.gas;

      if (isGas && !gasAlertShown) {
        showGasPopup();
        gasAlertShown = true;
      }

      // 🔁 Reset lại nếu trạng thái đã an toàn
      if (!isGas && gasAlertShown) {
        gasAlertShown = false;
      }
    })
    .catch(err => console.error("Lỗi khi kiểm tra khí gas:", err));
}




let faceAlertShown = false;

function showFacePopup() {
  const popup = document.getElementById('face-popup');
  popup.style.display = 'block';
  setTimeout(() => {
    popup.style.display = 'none';
  }, 5000);
}

function checkFaceStatus() {
  fetch('/face_status')
    .then(res => res.json())
    .then(data => {
      const isStranger = data.alert;

      if (isStranger && !faceAlertShown) {
        showFacePopup();
        faceAlertShown = true;
      }

      if (!isStranger && faceAlertShown) {
        faceAlertShown = false;
      }
    })
    .catch(err => console.error("Lỗi khi kiểm tra người lạ:", err));
}
// ✅ Đảm bảo chạy định kỳ sau khi DOM đã load
window.addEventListener("DOMContentLoaded", () => {
  setInterval(checkFaceStatus, 5000);  // gọi mỗi 3 giây
});
function updateStrangerImage() {
  const img = document.getElementById("strangerImage");
  img.src = "/latest_stranger_image?" + new Date().getTime(); // tránh cache
}

// 👉 Gọi API lịch sử người lạ
function loadStrangerHistory() {
    fetch('/get_alert_history?type=face')
        .then(res => res.json())
        .then(data => {
            const ul = document.getElementById("strangerLog");
            ul.innerHTML = "";

            data.slice(0, 10).forEach((item, index) => {
                const li = document.createElement("li");
                li.style.marginBottom = "10px";

                const text = document.createElement("div");
                const dateUTC = new Date(item.timestamp);
                const dateVN = new Date(dateUTC.getTime() - 7 * 60 * 60 * 1000); // cộng 7 giờ
                text.textContent = `👤 ${item.message} lúc ${dateVN.toLocaleString('vi-VN')}`;
                li.appendChild(text);

                if (index === 0) {
                    const img = document.createElement("img");
                    img.src = "/latest_stranger_image?" + new Date().getTime();
                    img.alt = "Người lạ gần nhất";
                    img.style.maxWidth = "200px";
                    img.style.border = "2px solid red";
                    img.style.borderRadius = "10px";
                    img.style.marginTop = "6px";
                    li.appendChild(img);
                }

                ul.appendChild(li);
            });
        });
}


// 👉 Gọi API lịch sử khí GAS
function loadGasHistory() {
    fetch('/get_alert_history?type=gas')
        .then(res => res.json())
        .then(data => {
            const ul = document.getElementById("gasLog");
            ul.innerHTML = "";
            data.slice(0, 10).forEach(item => {
                const li = document.createElement("li");
                const dateUTC = new Date(item.timestamp);
                const dateVN = new Date(dateUTC.getTime() - 7 * 60 * 60 * 1000); // cộng 7 giờ
                li.textContent = `🔥 ${item.message} lúc ${dateVN.toLocaleString('vi-VN')}`;
                ul.appendChild(li);
            });
        });
}

// 👉 Gọi API biểu đồ điện
let usageChartInstance = null;
let priceChartInstance = null;

function loadEnergyCharts() {
    fetch('/get_energy_summary')
        .then(res => res.json())
        .then(data => {
            const labels = data.map(item => item.day.split(',')[1].trim()); // ví dụ: "22 May 2025"
            const usageData = data.map(item => item.usage);
            const costData = data.map(item => item.cost);

            // Chỉ vẽ nếu phần tử đang hiển thị
            const usageCanvas = document.getElementById('usageChart');
            if (usageCanvas && usageCanvas.offsetParent !== null) {
                const ctx = usageCanvas.getContext('2d');
                if (usageChartInstance) usageChartInstance.destroy();
                usageChartInstance = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels,
                        datasets: [{
                            label: 'Điện năng tiêu thụ (kWh)',
                            data: usageData,
                            backgroundColor: 'rgba(54, 162, 235, 0.6)'
                        }]
                    },
                    options: {
                        responsive: true,
                        scales: {
                            y: {
                                beginAtZero: true
                            }
                        }
                    } 
                });
            }

            const priceCanvas = document.getElementById('priceChart');
            if (priceCanvas && priceCanvas.offsetParent !== null) {
                const ctx = priceCanvas.getContext('2d');
                if (priceChartInstance) priceChartInstance.destroy();
                priceChartInstance = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels,
                        datasets: [{
                            label: 'Chi phí (VNĐ)',
                            data: costData,
                            backgroundColor: 'rgba(255, 159, 64, 0.6)'
                        }]
                    },
                    options: {
                        responsive: true,
                        scales: {
                            y: {
                                beginAtZero: true
                            }
                        }
                    }
                });
            }
        });
}

// 👉 Khi chuyển tab “Lịch sử”, load dữ liệu
function switchHistoryView(type) {
    // Ẩn tất cả các vùng lịch sử
    document.querySelectorAll('.history-section').forEach(div => {
        div.classList.remove('active');
        div.style.display = 'none';
    });

    const sectionId = 'history' + capitalizeFirstLetter(type);
    const section = document.getElementById(sectionId);
    section.classList.add('active');
    section.style.display = 'block'; // 💡 Quan trọng: Hiển thị trước khi vẽ biểu đồ

    if (type === 'stranger') {
        loadStrangerHistory();
    } else if (type === 'gas') {
        loadGasHistory();
    } else if (type === 'electricUsage' || type === 'electricPrice') {
        // 💡 Đảm bảo biểu đồ được gọi sau khi DOM cập nhật hoàn toàn
        setTimeout(() => {
            if (type === 'electricUsage' && usageChartInstance) usageChartInstance.destroy();
            if (type === 'electricPrice' && priceChartInstance) priceChartInstance.destroy();
            loadEnergyCharts();
        }, 300);
    }
}

function capitalizeFirstLetter(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}
// 👉 Khởi tạo socket ngay sau khi thư viện được nạp
const socket = io("https://smarthome.smarthomediY.click"); // hoặc IP máy Flask


window.addEventListener("DOMContentLoaded", () => {
    setupEventListeners();
    connectToHomeAssistant();


    socket.on("connect", () => {
        console.log("🟢 Đã kết nối WebSocket với server Flask");
    });

    socket.on("gas_alert", (data) => {
        console.log("🔥 GAS ALERT:", data);
        showGasPopup();  // hàm đã có sẵn trong HTML
    });

    socket.on("face_alert", (data) => {
        console.log("🧍 Người lạ trước cửa:", data);
        showFacePopup();  // hàm hiển thị popup người lạ
    });
});