// script.js

const API_BASE_URL = '/api';

// --- UI HELPERS (TOAST & LOADER) ---
function injectStyles() {
    if (document.getElementById('ui-styles')) return;
    const style = document.createElement('style');
    style.id = 'ui-styles';
    style.innerHTML = `
        #loadingOverlay {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(255, 255, 255, 0.8);
            backdrop-filter: blur(5px);
            z-index: 9999;
            display: none; flex-direction: column; align-items: center; justify-content: center;
            animation: fadeIn 0.3s ease;
        }
        .loader-spinner {
            width: 50px; height: 50px; border: 5px solid #f3f3f3;
            border-top: 5px solid #007bff; border-radius: 50%;
            animation: spin 1s linear infinite; margin-bottom: 15px;
        }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    `;
    document.head.appendChild(style);
}

function showToast(message, type = 'success') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = 'position: fixed; top: 20px; right: 20px; z-index: 10000; display: flex; flex-direction: column; gap: 10px;';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    const bgColor = type === 'error' ? '#dc3545' : (type === 'info' ? '#17a2b8' : '#28a745');
    const icon = type === 'error' ? 'fa-circle-exclamation' : (type === 'info' ? 'fa-circle-info' : 'fa-circle-check');
    
    toast.style.cssText = `background: ${bgColor}; color: white; padding: 15px 20px; border-radius: 8px; box-shadow: 0 10px 25px rgba(0,0,0,0.2); opacity: 0; transform: translateX(100%); transition: all 0.4s cubic-bezier(0.68, -0.55, 0.27, 1.55); min-width: 300px; display: flex; align-items: center; gap: 12px; font-size: 14px; font-weight: 500;`;
    toast.innerHTML = `<i class="fa-solid ${icon}" style="font-size: 18px;"></i> <span>${message}</span>`;

    container.appendChild(toast);

    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(0)';
    });

    let timeoutId;
    const removeToast = () => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    };

    const startTimer = () => { timeoutId = setTimeout(removeToast, 3000); };
    toast.addEventListener('mouseenter', () => clearTimeout(timeoutId));
    toast.addEventListener('mouseleave', startTimer);
    startTimer();
}

// --- STAFF LOGIN ---
async function login() {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value.trim();

    if (!username || !password) {
        return showModal('Please enter both username and password.');
    }

    try {
        const response = await fetch(`${API_BASE_URL}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        if (response.ok) {
            const user = await response.json();
            
            const remember = document.getElementById('rememberMe') && document.getElementById('rememberMe').checked;
            const storage = remember ? localStorage : sessionStorage;
            storage.setItem('hmsCurrentUser', JSON.stringify(user));
            window.location.href = "dashboard.html";
        } else {
            const result = await response.json();
            showToast(result.message || 'Invalid username or password.', 'error');
        }
    } catch (error) {
        console.error('Login failed:', error);
        showModal('Could not connect to the server. Please ensure the server is running on http://localhost:3000');
    }
}

// --- GUEST LOGIN & BOOKING ---
async function sendGuestOtp() {
    const hotelName = document.getElementById('onlineHotelName').value;
    const email = document.getElementById('guestEmail').value.trim();

    if (!hotelName) {
        return showModal('Please select a hotel first.');
    }
    if (!email || !/\S+@\S+\.\S+/.test(email)) {
        return showModal('Please enter a valid email address.');
    }

    try {
        showLoading("Sending OTP...");
        const response = await fetch(`${API_BASE_URL}/guest/send-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        const result = await response.json();
        hideLoading();
        showToast(result.message, response.ok ? 'success' : 'error');
        if (response.ok) {
            document.getElementById('guestStep1').style.display = 'none';
            document.getElementById('guestStep2').style.display = 'block';
            document.getElementById('guestOtp').focus();
        }
    } catch (error) {
        hideLoading();
        showToast('Failed to send OTP. Please try again later.', 'error');
    }
}

async function verifyGuestOtp() {
    const email = document.getElementById('guestEmail').value.trim();
    const otp = document.getElementById('guestOtp').value.trim();
    if (!otp || otp.length !== 6) {
        return showModal('Please enter the 6-digit OTP.');
    }

    try {
        const response = await fetch(`${API_BASE_URL}/guest/verify-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, otp })
        });
        const result = await response.json();

        if (result.success) {
            showToast('OTP Verified!', 'success');
            showBookingModal();
        } else {
            showModal(result.message || 'Verification failed.');
        }
    } catch (error) {
        showModal('An error occurred during verification.');
    }
}

async function showBookingModal() {
    const hotelName = document.getElementById('onlineHotelName').value;
    if (!hotelName) {
        return showModal('Please select a hotel to see room availability.');
    }

    try {
        const response = await fetch(`${API_BASE_URL}/hotels/availability?hotelName=${encodeURIComponent(hotelName)}`);
        if (!response.ok) {
            const err = await response.json();
            return showModal(err.message || 'Could not fetch room availability.');
        }
        const availableRooms = await response.json();

        document.getElementById('guestStep2').style.display = 'none';
        document.getElementById('guestStep3').style.display = 'block';
        
        // --- Populate Room Type Dropdown & Date Inputs ---
        const uniqueRoomTypes = [...new Set(availableRooms.map(r => r.ROOM_TYPE))];
        
        const availabilityDiv = document.getElementById('roomAvailability');
        availabilityDiv.innerHTML = `
            <div style="text-align:left; margin-bottom:15px;">
                <label style="font-size:12px; font-weight:bold; color:#555;">Select Room Type</label>
                <select id="bookingRoomType" style="width:100%; padding:8px; margin:5px 0 10px; border:1px solid #ccc; border-radius:4px;">
                    ${uniqueRoomTypes.map(t => `<option value="${t}">${t}</option>`).join('')}
                </select>
                
                <label style="font-size:12px; font-weight:bold; color:#555;">Check-in Date & Time</label>
                <div id="bookingCalendarContainer" style="margin-bottom: 10px; border: 1px solid #ccc; border-radius: 4px; padding: 5px;">
                    <!-- Calendar will be rendered here -->
                </div>
                <input type="datetime-local" id="bookingCheckIn" style="width:100%; padding:8px; margin:5px 0 10px; border:1px solid #ccc; border-radius:4px; display:none;">
                
                <label style="font-size:12px; font-weight:bold; color:#555;">Duration (Hours)</label>
                <input type="number" id="bookingDuration" value="24" min="1" style="width:100%; padding:8px; margin:5px 0 10px; border:1px solid #ccc; border-radius:4px;">
            </div>
        `;

        // Hide old select if exists
        const oldSelect = document.getElementById('onlineRoomType');
        if(oldSelect) oldSelect.style.display = 'none';

        // Setup photo listener on new select
        const roomTypeSelect = document.getElementById('bookingRoomType');
        
        // Initialize Calendar
        const now = new Date();
        renderCalendar(hotelName, uniqueRoomTypes[0], now.getMonth() + 1, now.getFullYear());

        // --- 3. Show Hotel Photos (Side Modals) ---
        // Fetch general hotel photos (or random room photos)
        try {
            const photoResponse = await fetch(`${API_BASE_URL}/hotels/${encodeURIComponent(hotelName)}/photos`);
            if (photoResponse.ok) {
                const hotelPhotos = await photoResponse.json();
                renderSideModals(hotelPhotos);
            }
        } catch (e) {
            console.error("Failed to load hotel photos", e);
        }

        // --- 4. Handle Room Type Selection for Photos ---
        roomTypeSelect.onchange = () => {
            const selectedType = roomTypeSelect.value;
            // Update Calendar for new room type
            const now = new Date();
            renderCalendar(hotelName, selectedType, now.getMonth() + 1, now.getFullYear());
            if (!selectedType) {
                // Revert to hotel photos if selection cleared
                fetch(`${API_BASE_URL}/hotels/${encodeURIComponent(hotelName)}/photos`)
                    .then(res => res.json())
                    .then(photos => renderSideModals(photos))
                    .catch(console.error);
                return;
            }

            // Filter photos from available rooms of this type
            const typePhotos = [];
            availableRooms.forEach(room => {
                if (room.ROOM_TYPE === selectedType && room.PHOTOS) {
                    try {
                        const p = JSON.parse(room.PHOTOS);
                        if (Array.isArray(p)) typePhotos.push(...p);
                    } catch(e) {}
                }
            });
            
            // If we found photos for this room type, show them. Otherwise keep hotel photos or clear.
            if (typePhotos.length > 0) {
                renderSideModals(typePhotos);
            } else {
                renderSideModals([]); // Or keep previous? Let's clear to indicate no specific photos.
            }
        };

        document.getElementById('onlineGuestName').focus();
    } catch (error) {
        console.error('Error fetching availability:', error);
        showModal('A network error occurred while checking for rooms.');
    }
}

async function renderCalendar(hotelName, roomType, month, year) {
    const container = document.getElementById('bookingCalendarContainer');
    if (!container) return;

    container.innerHTML = '<div class="loader" style="width:20px; height:20px; margin: 10px auto;"></div>';

    try {
        const response = await fetch(`${API_BASE_URL}/hotels/calendar-availability?hotelName=${encodeURIComponent(hotelName)}&roomType=${encodeURIComponent(roomType)}&month=${month}&year=${year}`);
        const data = await response.json();
        
        const totalRooms = data.totalRooms || 0;
        const bookings = data.bookings || [];
        
        // Calculate occupancy per day
        const daysInMonth = new Date(year, month, 0).getDate();
        const occupancy = new Array(daysInMonth + 1).fill(0);

        bookings.forEach(b => {
            const start = new Date(b.CHECK_IN_TIME);
            const end = new Date(b.CHECK_OUT_TIME);
            
            for (let d = 1; d <= daysInMonth; d++) {
                const current = new Date(year, month - 1, d, 12, 0, 0); // Noon to avoid boundary issues
                if (current >= start && current <= end) {
                    occupancy[d]++;
                }
            }
        });

        // Build HTML
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        
        let html = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                <button onclick="renderCalendar('${hotelName}', '${roomType}', ${month === 1 ? 12 : month - 1}, ${month === 1 ? year - 1 : year})" style="border:none; background:none; cursor:pointer;">&#10094;</button>
                <span style="font-weight:bold; font-size:14px;">${monthNames[month-1]} ${year}</span>
                <button onclick="renderCalendar('${hotelName}', '${roomType}', ${month === 12 ? 1 : month + 1}, ${month === 12 ? year + 1 : year})" style="border:none; background:none; cursor:pointer;">&#10095;</button>
            </div>
            <div style="display:grid; grid-template-columns: repeat(7, 1fr); gap:2px; text-align:center; font-size:12px;">
                <div style="font-weight:bold;">Su</div><div style="font-weight:bold;">Mo</div><div style="font-weight:bold;">Tu</div><div style="font-weight:bold;">We</div><div style="font-weight:bold;">Th</div><div style="font-weight:bold;">Fr</div><div style="font-weight:bold;">Sa</div>
        `;

        const firstDay = new Date(year, month - 1, 1).getDay();
        for (let i = 0; i < firstDay; i++) {
            html += `<div></div>`;
        }

        const today = new Date();
        today.setHours(0,0,0,0);

        for (let d = 1; d <= daysInMonth; d++) {
            const dateObj = new Date(year, month - 1, d);
            const isFull = occupancy[d] >= totalRooms;
            const isPast = dateObj < today;
            
            let bg = '#e8f5e9'; // Greenish (Available)
            let cursor = 'pointer';
            let clickHandler = `selectDate(${year}, ${month}, ${d})`;

            if (isPast) { bg = '#f0f0f0'; cursor = 'default'; clickHandler = ''; }
            else if (isFull) { bg = '#ffcdd2'; cursor = 'not-allowed'; clickHandler = ''; } // Reddish (Full)

            html += `<div onclick="${clickHandler}" style="background:${bg}; padding:5px; border-radius:3px; cursor:${cursor}; color:${isPast ? '#999' : '#333'}; position:relative;">
                        ${d}
                        ${isFull ? '<span style="display:block; font-size:8px; color:red;">FULL</span>' : ''}
                     </div>`;
        }

        html += `</div>`;
        container.innerHTML = html;

    } catch (e) {
        container.innerHTML = '<p style="color:red; font-size:12px;">Failed to load calendar.</p>';
    }
}

window.selectDate = function(y, m, d) {
    const str = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T12:00`;
    document.getElementById('bookingCheckIn').value = str;
    // Visual feedback could be added here
    const allDays = document.querySelectorAll('#bookingCalendarContainer div[onclick]');
    allDays.forEach(div => div.style.border = 'none');
    event.target.style.border = '2px solid #007bff';
}

let carouselIntervals = [];

function renderSideModals(photos) {
    // Create modals if they don't exist
    if (!document.getElementById('leftSideModal')) {
        const left = document.createElement('div');
        left.id = 'leftSideModal';
        left.className = 'side-modal left';
        document.body.appendChild(left);

        const right = document.createElement('div');
        right.id = 'rightSideModal';
        right.className = 'side-modal right';
        document.body.appendChild(right);
    }

    const leftModal = document.getElementById('leftSideModal');
    const rightModal = document.getElementById('rightSideModal');

    // Clear previous intervals to stop old animations
    carouselIntervals.forEach(clearInterval);
    carouselIntervals = [];

    // Clear current
    leftModal.innerHTML = '';
    rightModal.innerHTML = '';

    if (!photos || photos.length === 0) {
        leftModal.style.display = 'none';
        rightModal.style.display = 'none';
        return;
    }

    leftModal.style.display = 'flex';
    rightModal.style.display = 'flex';

    // Split photos for left and right
    const leftPhotos = photos.filter((_, i) => i % 2 === 0);
    const rightPhotos = photos.filter((_, i) => i % 2 !== 0);

    startCarousel(leftModal, leftPhotos, photos);
    startCarousel(rightModal, rightPhotos, photos);
}

function startCarousel(container, images, allPhotos) {
    if (images.length === 0) return;

    // Create image elements
    images.forEach((photoSrc, index) => {
        const img = document.createElement('img');
        img.src = photoSrc;
        img.className = index === 0 ? 'carousel-slide active' : 'carousel-slide';
        // Force absolute positioning for stacking except for the active one initially to set height? 
        // Actually CSS handles opacity. We need them stacked.
        img.style.position = 'absolute';
        if (index === 0) img.style.opacity = '1';
        
        // Add click listener for full screen
        img.style.cursor = 'pointer';
        const globalIndex = allPhotos.indexOf(photoSrc);
        img.onclick = () => openFullScreenViewer(allPhotos, globalIndex);
        
        container.appendChild(img);
    });

    if (images.length > 1) {
        let currentIndex = 0;
        const slides = container.querySelectorAll('.carousel-slide');
        const interval = setInterval(() => {
            slides[currentIndex].style.opacity = '0';
            currentIndex = (currentIndex + 1) % slides.length;
            slides[currentIndex].style.opacity = '1';
        }, 3000); // Change every 3 seconds
        carouselIntervals.push(interval);
    }
}

let currentViewerPhotos = [];
let currentViewerIndex = 0;

function openFullScreenViewer(photos, index) {
    currentViewerPhotos = photos;
    currentViewerIndex = index;

    let viewer = document.getElementById('fullScreenViewer');
    if (!viewer) {
        viewer = document.createElement('div');
        viewer.id = 'fullScreenViewer';
        viewer.className = 'fullscreen-viewer';
        viewer.innerHTML = `
            <span class="close-viewer">&times;</span>
            <button class="prev-btn">&#10094;</button>
            <button class="next-btn">&#10095;</button>
            <img class="viewer-content" id="fullScreenImage">
        `;
        document.body.appendChild(viewer);
        
        const closeBtn = viewer.querySelector('.close-viewer');
        closeBtn.onclick = () => {
            viewer.style.display = 'none';
        };
        
        viewer.onclick = (e) => {
            if (e.target === viewer) {
                viewer.style.display = 'none';
            }
        };

        viewer.querySelector('.prev-btn').onclick = (e) => {
            e.stopPropagation();
            changeViewerImage(-1);
        };
        viewer.querySelector('.next-btn').onclick = (e) => {
            e.stopPropagation();
            changeViewerImage(1);
        };

        // Keyboard navigation
        document.addEventListener('keydown', (e) => {
            if (viewer.style.display === 'none') return;
            if (e.key === 'ArrowLeft') changeViewerImage(-1);
            if (e.key === 'ArrowRight') changeViewerImage(1);
            if (e.key === 'Escape') viewer.style.display = 'none';
        });
    }
    
    updateViewerImage();
    viewer.style.display = 'flex';
}

function changeViewerImage(direction) {
    currentViewerIndex = (currentViewerIndex + direction + currentViewerPhotos.length) % currentViewerPhotos.length;
    updateViewerImage();
}

function updateViewerImage() {
    const img = document.getElementById('fullScreenImage');
    if (currentViewerPhotos.length > 0) {
        img.src = currentViewerPhotos[currentViewerIndex];
    }
}

async function bookRoomOnline() {
    const roomTypeElem = document.getElementById('bookingRoomType');
    const checkInElem = document.getElementById('bookingCheckIn');
    const durationElem = document.getElementById('bookingDuration');

    const bookingData = {
        guestName: document.getElementById('onlineGuestName').value.trim(),
        email: document.getElementById('guestEmail').value.trim(),
        roomType: roomTypeElem ? roomTypeElem.value : document.getElementById('onlineRoomType').value,
        hotelName: document.getElementById('onlineHotelName').value,
        checkIn: checkInElem ? checkInElem.value : null,
        duration: durationElem ? durationElem.value : null
    };

    if (!bookingData.guestName || !bookingData.roomType || !bookingData.checkIn || !bookingData.duration) {
        return showModal('Please enter your name, room type, date, and duration.');
    }

    try {
        const response = await fetch(`${API_BASE_URL}/online-bookings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bookingData)
        });
        const result = await response.json();
        if (response.ok) {
            const bookingConfirmation = `
                <h3>Booking Successful!</h3>
                <p>Thank you, ${bookingData.guestName}.</p>
                <p>Your Booking ID is: <strong>${result.bookingId}</strong></p>
                <p>Please provide the Booking ID and Verification Code  to confirm your room at the reception.</p>
                <button onclick="window.location.reload()">Book Another Room</button>
            `;
            document.getElementById('guestLoginForm').innerHTML = bookingConfirmation;
        } else {
            showToast(result.message || 'Booking failed.', 'error');
        }
    } catch (error) {
        showModal('An error occurred while booking.');
    }
}


// --- UI HELPERS ---
function showForm(formId) {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('guestLoginForm').style.display = 'none';
    document.getElementById(formId).style.display = 'block';

    document.getElementById('employeeTabBtn').classList.remove('active');
    document.getElementById('guestTabBtn').classList.remove('active');

    if (formId === 'loginForm') {
        document.getElementById('employeeTabBtn').classList.add('active');
    } else {
        document.getElementById('guestTabBtn').classList.add('active');
    }
}

// --- FORGOT PASSWORD ---
function openForgotPasswordModal() {
    document.getElementById('forgotPasswordModal').style.display = 'flex';
    // Reset state
    document.getElementById('forgotEmail').value = '';
    document.getElementById('forgotEmail').disabled = false;
    document.getElementById('forgotOtp').value = '';
    document.getElementById('forgotOtpSection').style.display = 'none';
    const btn = document.getElementById('forgotActionBtn');
    btn.textContent = 'Send OTP';
    btn.onclick = sendForgotOtp;
}

function closeForgotPasswordModal() {
    document.getElementById('forgotPasswordModal').style.display = 'none';
}

async function sendForgotOtp() {
    const email = document.getElementById('forgotEmail').value.trim();
    if (!email) return showModal('Please enter your email.');

    try {
        showLoading("Sending OTP...");
        const response = await fetch(`${API_BASE_URL}/auth/forgot-password-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        const result = await response.json();
        hideLoading();
        showToast(result.message, response.ok ? 'success' : 'error');
        
        if (response.ok) {
            document.getElementById('forgotOtpSection').style.display = 'block';
            document.getElementById('forgotEmail').disabled = true;
            const btn = document.getElementById('forgotActionBtn');
            btn.textContent = 'Verify & Send Reset Link';
            btn.onclick = verifyForgotOtp;
        }
    } catch (error) {
        hideLoading();
        showToast('Failed to send OTP.', 'error');
    }
}

async function verifyForgotOtp() {
    const email = document.getElementById('forgotEmail').value.trim();
    const otp = document.getElementById('forgotOtp').value.trim();
    
    try {
        showLoading("Verifying and sending reset link...");
        const response = await fetch(`${API_BASE_URL}/auth/verify-forgot-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, otp })
        });
        const result = await response.json();
        hideLoading();
        showToast(result.message, response.ok ? 'success' : 'error');
        if (response.ok) {
            closeForgotPasswordModal();
        }
    } catch (error) {
        hideLoading();
        showModal('Verification failed.');
    }
}

async function populateHotelsDropdown() {
    try {
        const response = await fetch(`${API_BASE_URL}/hotels`);
        if (!response.ok) {
            console.error('Failed to fetch hotels for dropdown.');
            return;
        }
        const hotelNames = await response.json();
        const selectElement = document.getElementById('onlineHotelName');
        
        hotelNames.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            selectElement.appendChild(option);
        });
    } catch (error) {
        console.error('Error populating hotels dropdown:', error);
    }
}

// Event listener for Enter key on password field
document.addEventListener('DOMContentLoaded', function() {
    const usernameField = document.getElementById('loginUsername');
    const passwordField = document.getElementById('loginPassword');
    
    if (passwordField) {
        passwordField.addEventListener('keypress', function(event) {
            if (event.key === 'Enter') {
                login();
            }
        });
    }
    
    if (usernameField) {
        usernameField.addEventListener('keypress', function(event) {
            if (event.key === 'Enter') {
                login();
            }
        });
    }

    injectStyles();

    // Populate the hotel selection dropdown on the guest form
    populateHotelsDropdown();

    // Listener for hotel selection to trigger background slideshow
    const hotelSelect = document.getElementById('onlineHotelName');
    if (hotelSelect) {
        hotelSelect.addEventListener('change', function() {
            const hotelName = this.value;
            if (hotelName) {
                loadHotelBackground(hotelName);
                loadHotelFeatures(hotelName);

                // Update Header Title to Hotel Name immediately
                const headers = document.querySelectorAll('h2'); 
                headers.forEach(header => {
                    if(header && (header.textContent.includes('Hotel Management') || header.textContent.includes('Guest Login'))) header.textContent = hotelName;
                });
            } else {
                removeHotelBackground();
                removeScrollingFeatures();
            }
        });
    }

    // --- INJECT UI ELEMENTS ---
    
    // 1. Inject "Remember Me" Checkbox into Staff Login Form
    const loginBtn = document.querySelector('#loginForm button');
    if (loginBtn) {
        const div = document.createElement('div');
        div.className = 'remember-me-container';
        div.innerHTML = '<input type="checkbox" id="rememberMe"> <label for="rememberMe">Remember Me</label>';
        loginBtn.parentNode.insertBefore(div, loginBtn);
    }

    // 2. Inject "Contact Us" Button into Guest Login Form
    const guestStep1 = document.getElementById('guestStep1');
    if (guestStep1) {
        const contactBtn = document.createElement('button');
        contactBtn.className = 'main-btn contact-hotel-btn';
        contactBtn.innerHTML = '<i class="fa-solid fa-address-card"></i> Contact Hotel';
        contactBtn.onclick = (e) => {
            e.preventDefault();
            openContactModal();
        };
        guestStep1.appendChild(contactBtn);
    }

    // 3. Check for Hotel Slug in URL (e.g., /thegrandhotel.com)
    checkUrlForHotelSlug();
});

async function checkUrlForHotelSlug() {
    const path = window.location.pathname.substring(1); // Remove leading slash
    // Ignore standard pages or empty paths
    if (!path || path === 'index.html' || path === 'dashboard.html' || path === 'dinein.html' || path === 'room-login.html' || path.startsWith('api/')) {
        return;
    }

    try {
        const tch(`${API_BASE_URL}/ui-settings?hotelName=${encodeURIComponent(path.replace('.com', ''))}`) // Approximate lookup, ideally resolve-slug returns hotelName first
        ]);
        
        if (response.ok) {
            const data = await response.json();
            const hotelName = data.hotelName;
            const logo = data.logo;
            const themeColor = data.themeColor;

            // Fetch UI settings specifically for this hotel now that we have the name
            fetch(`${API_BASE_URL}/ui-settings?hotelName=${encodeURIComponent(hotelName)}`)
                .then(res => res.json())
                .then(ui => {
                    if (ui.GUEST_LOGIN_BG) document.body.style.backgroundColor = ui.GUEST_LOGIN_BG;
                    if (ui.PRIMARY_COLOR) {
                        const style = document.createElement('style');
                        style.innerHTML = `.main-btn, .confirm-btn, .auth-card button { background-color: ${ui.PRIMARY_COLOR} !important; border-color: ${ui.PRIMARY_COLOR} !important; }`;
                        document.head.appendChild(style);
                    }
                }).catch(e => console.log("No custom UI settings"));
            
            // Switch to Guest Tab
            showForm('guestLoginForm');

            // Hide Staff Login Tab
            const employeeBtn = document.getElementById('employeeTabBtn');
            if (employeeBtn) employeeBtn.style.display = 'none';

            // Hide Guest Tab Button (to remove "Guest Login / Booking" text)
            const guestBtn = document.getElementById('guestTabBtn');
            if (guestBtn) guestBtn.style.display = 'none';
            
            // Pre-select hotel and lock it
            const select = document.getElementById('onlineHotelName');
            if (select) {
                // Wait briefly for populateHotelsDropdown to finish if needed, or just set value
                // Since populate is async, we might need to add the option if it hasn't loaded yet
                if (!Array.from(select.options).some(opt => opt.value === hotelName)) {
                    const opt = document.createElement('option');
                    opt.value = hotelName;
                    opt.textContent = hotelName;
                    select.appendChild(opt);
                }
                select.value = hotelName;
                select.style.display = 'none'; // Remove drop down box
                // Hide label if present
                if (select.previousElementSibling && select.previousElementSibling.tagName === 'LABEL') {
                    select.previousElementSibling.style.display = 'none';
                }
                
                // Trigger background load
                loadHotelBackground(hotelName);
                loadHotelFeatures(hotelName);
                
                // Inject Logo if available
                if (logo) {
                    const formContainer = document.getElementById('guestLoginForm');
                    let logoImg = document.getElementById('hotelCustomLogo');
                    if (!logoImg) {
                        logoImg = document.createElement('img');
                        logoImg.id = 'hotelCustomLogo';
                        logoImg.style.cssText = 'width: 80px; height: 80px; border-radius: 50%; object-fit: cover; display: block; margin: 0 auto 15px auto; border: 3px solid #fff; box-shadow: 0 2px 5px rgba(0,0,0,0.2);';
                        formContainer.insertBefore(logoImg, formContainer.firstChild);
                    }
                    logoImg.src = logo;
                }

                // Update Header Title to Hotel Name
                const headers = document.querySelectorAll('h2'); 
                headers.forEach(header => {
                    if(header && (header.textContent.includes('Hotel Management') || header.textContent.includes('Guest Login'))) header.textContent = hotelName;
                });

                // Apply Theme Color if available
                if (themeColor) {
                    // Inject dynamic styles for primary buttons and headers
                    const style = document.createElement('style');
                    style.innerHTML = `
                        .main-btn, .confirm-btn, .auth-card button { background-color: ${themeColor} !important; border-color: ${themeColor} !important; }
                        h2, h3, h4 { color: ${themeColor} !important; }
                    `;
                    document.head.appendChild(style);
                }

                // Add a "Return to Main" link
                const container = document.querySelector('.auth-card');
                if (container && !document.getElementById('returnLink')) {
                    const link = document.createElement('a');
                    link.id = 'returnLink';
                    link.href = '/';
                    link.innerHTML = '<i class="fa-solid fa-arrow-left"></i> Not your hotel?';
                    link.style.cssText = 'display:block; text-align:center; margin-top:10px; font-size:12px; color:#666; text-decoration:none;';
                    container.appendChild(link);
                }
            }
        }
    } catch (e) {
        console.error("Error resolving hotel slug", e);
    }
}

// --- MODAL FUNCTIONS ---
function showModal(message, onConfirm = null) {
    const modal = document.getElementById('actionModal');
    const modalBox = document.getElementById('modalBox');

    modalBox.innerHTML = `
        <h3 style="margin-top: 0; color: #333;">Notification</h3>
        <p id="modalMessage" style="color: #666; margin: 15px 0;"></p>
        <div class="modal-buttons">
          <button class="confirm-btn" id="confirmBtn">OK</button>
        </div>
    `;

    document.getElementById('modalMessage').textContent = message;
    const confirmBtn = document.getElementById('confirmBtn');

    confirmBtn.onclick = () => {
        closeModal();
        if (onConfirm) onConfirm();
    };

    modal.style.display = 'flex';
}

function showLoading(message) {
    let overlay = document.getElementById('loadingOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'loadingOverlay';
        document.body.appendChild(overlay);
    }
    overlay.innerHTML = `
        <div class="loader-spinner"></div>
        <p style="font-size: 18px; color: #555; font-weight: 500;">${message}</p>
    `;
    overlay.style.display = 'flex';
}

function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.style.display = 'none';
}

function closeModal() {
    document.getElementById('actionModal').style.display = 'none';
}

// --- BACKGROUND SLIDESHOW ---
let bgInterval = null;

async function loadHotelBackground(hotelName) {
    try {
        const response = await fetch(`${API_BASE_URL}/hotels/${encodeURIComponent(hotelName)}/photos`);
        if (response.ok) {
            const photos = await response.json();
            if (photos && photos.length > 0) {
                startFullScreenSlideshow(photos);
            } else {
                removeHotelBackground();
            }
        }
    } catch (e) {
        console.error("Failed to load background photos", e);
    }
}

function startFullScreenSlideshow(photos) {
    let container = document.getElementById('bg-slideshow-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'bg-slideshow-container';
        // Insert as first child so it sits behind everything
        document.body.insertBefore(container, document.body.firstChild);
    }
    
    container.innerHTML = '';
    if (bgInterval) clearInterval(bgInterval);
    
    photos.forEach((src, index) => {
        const img = document.createElement('img');
        img.src = src;
        img.className = 'bg-slide';
        if (index === 0) img.classList.add('active');
        container.appendChild(img);
    });
    
    document.body.classList.add('has-bg-slideshow');
    addCloseButtonToModal();
    
    let idx = 0;
    const slides = container.querySelectorAll('.bg-slide');
    if (slides.length > 1) {
        bgInterval = setInterval(() => {
            slides[idx].classList.remove('active');
            idx = (idx + 1) % slides.length;
            slides[idx].classList.add('active');
        }, 4000);
    }
}

function removeHotelBackground() {
    const container = document.getElementById('bg-slideshow-container');
    if (container) container.remove();
    document.body.classList.remove('has-bg-slideshow');
    removeCloseButtonFromModal();
    if (bgInterval) clearInterval(bgInterval);
}

function addCloseButtonToModal() {
    const card = document.querySelector('.auth-card');
    // Check if button exists to avoid duplicates
    if (!card || document.getElementById('bgModalCloseBtn')) return;

    const btn = document.createElement('button');
    btn.id = 'bgModalCloseBtn';
    btn.innerHTML = '&times;';
    btn.style.cssText = 'position: absolute; top: 10px; right: 15px; background: transparent; border: none; font-size: 28px; cursor: pointer; color: #333; z-index: 10; line-height: 1; outline: none;';
    btn.title = "Return to default view";
    
    btn.onclick = (e) => {
        e.preventDefault();
        const select = document.getElementById('onlineHotelName');
        if (select) select.value = ""; 
        removeHotelBackground();
    };

    if (getComputedStyle(card).position === 'static') {
        card.style.position = 'relative';
    }
    card.appendChild(btn);
}

function removeCloseButtonFromModal() {
    const btn = document.getElementById('bgModalCloseBtn');
    if (btn) btn.remove();
}

// --- SCROLLING FEATURES ---
async function loadHotelFeatures(hotelName) {
    try {
        const [featRes, settingsRes] = await Promise.all([
            fetch(`${API_BASE_URL}/hotel-features?hotelName=${encodeURIComponent(hotelName)}`),
            fetch(`${API_BASE_URL}/hotel/settings?hotelName=${encodeURIComponent(hotelName)}`)
        ]);
        if (featRes.ok) {
            const features = await featRes.json();
            const settings = await settingsRes.json();
            const speed = settings.FEATURE_SCROLL_SPEED || 20;

            if (features && features.length > 0) {
                renderScrollingFeatures(features, speed);
            } else {
                removeScrollingFeatures();
            }
        }
    } catch (e) {
        console.error("Failed to load features", e);
    }
}

function renderScrollingFeatures(features, speed) {
    removeScrollingFeatures(); // Clear existing

    const createSidebar = (side) => {
        const container = document.createElement('div');
        container.className = `feature-scroll-container ${side}`;
        
        const content = document.createElement('div');
        content.className = 'feature-scroll-content';
        content.style.animationDuration = `${speed}s`;
        
        // Duplicate content to ensure smooth infinite scroll
        const listHtml = features.map(f => `<div class="feature-item"><i class="fa-solid ${f.ICON || 'fa-star'}"></i> ${f.FEATURE_TEXT}</div>`).join('');
        content.innerHTML = listHtml;
        
        container.appendChild(content);
        document.body.appendChild(container);
    };

    createSidebar('left');
    createSidebar('right');
}

function removeScrollingFeatures() {
    document.querySelectorAll('.feature-scroll-container').forEach(el => el.remove());
}

// --- CONTACT MODAL ---
async function openContactModal() {
    const hotelName = document.getElementById('onlineHotelName').value;
    if (!hotelName) {
        return showModal('Please select a hotel first to view contact details.');
    }

    showLoading("Fetching contact details...");
    try {
        const response = await fetch(`${API_BASE_URL}/hotel/contact?hotelName=${encodeURIComponent(hotelName)}`);
        const data = await response.json();
        closeModal();

        if (response.ok) {
            const modal = document.getElementById('actionModal');
            const modalBox = document.getElementById('modalBox');
            modalBox.innerHTML = `
                <h3 style="margin-top:0; color:#007bff;">${hotelName}</h3>
                <div style="text-align:left; margin: 15px 0; font-size: 15px; line-height: 1.6;">
                    <p><strong><i class="fa-solid fa-user"></i> Owner:</strong> ${data.FULL_NAME}</p>
                    <p><strong><i class="fa-solid fa-phone"></i> Mobile:</strong> ${data.MOBILE_NUMBER}</p>
                    <p><strong><i class="fa-solid fa-envelope"></i> Email:</strong> ${data.EMAIL}</p>
                    <p><strong><i class="fa-solid fa-location-dot"></i> Address:</strong> ${data.ADDRESS || 'N/A'}</p>
                </div>
                <button class="confirm-btn" onclick="closeModal()" style="width:100%;">Close</button>
            `;
            modal.style.display = 'flex';
        } else {
            showModal(data.message || "Contact details not found.");
        }
    } catch (e) {
        closeModal();
        showModal("Failed to load contact details.");
    }
}