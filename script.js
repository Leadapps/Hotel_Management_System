// script.js

const API_BASE_URL = '/api';

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
            localStorage.setItem('hmsCurrentUser', JSON.stringify(user));
            window.location.href = "dashboard.html";
        } else {
            const result = await response.json();
            showModal(result.message || 'Invalid username or password.');
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
        showModal(result.message);
        if (response.ok) {
            document.getElementById('guestStep1').style.display = 'none';
            document.getElementById('guestStep2').style.display = 'block';
            document.getElementById('guestOtp').focus();
        }
    } catch (error) {
        showModal('Failed to send OTP. Please try again later.');
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
            showModal('OTP Verified!', () => showBookingModal());
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
        
        // --- 1. Populate Room Availability List ---
        // Display available rooms as a list
        const availabilityDiv = document.getElementById('roomAvailability');
        const roomList = availableRooms.map(r => `<li>${r.ROOM_NUMBER} (${r.ROOM_TYPE})</li>`).join('');
        availabilityDiv.innerHTML = `
            <p><strong>${availableRooms.length} rooms available.</strong></p>
            <ul style="list-style-type: none; padding-left: 0; margin-top: 5px; max-height: 100px; overflow-y: auto; text-align: left; border: 1px solid #eee; border-radius: 4px; padding: 5px;">
                ${roomList || '<li>No rooms available at the moment.</li>'}
            </ul>
        `;

        // --- 2. Populate Room Type Dropdown ---
        // Dynamically populate the room type dropdown
        const roomTypeSelect = document.getElementById('onlineRoomType');
        const uniqueRoomTypes = [...new Set(availableRooms.map(r => r.ROOM_TYPE))];
        roomTypeSelect.innerHTML = '<option value="">Select Room Type</option>'; // Clear and add default
        uniqueRoomTypes.forEach(type => {
            const option = document.createElement('option');
            option.value = type;
            option.textContent = type;
            roomTypeSelect.appendChild(option);
        });

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
    const bookingData = {
        guestName: document.getElementById('onlineGuestName').value.trim(),
        email: document.getElementById('guestEmail').value.trim(),
        roomType: document.getElementById('onlineRoomType').value,
        hotelName: document.getElementById('onlineHotelName').value 
    };

    if (!bookingData.guestName || !bookingData.roomType) {
        return showModal('Please enter your name and select a room type.');
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
            showModal(result.message || 'Booking failed.');
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
        showModal(result.message);
        
        if (response.ok) {
            document.getElementById('forgotOtpSection').style.display = 'block';
            document.getElementById('forgotEmail').disabled = true;
            const btn = document.getElementById('forgotActionBtn');
            btn.textContent = 'Verify & Send Reset Link';
            btn.onclick = verifyForgotOtp;
        }
    } catch (error) {
        showModal('Failed to send OTP.');
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
        showModal(result.message);
        if (response.ok) {
            closeForgotPasswordModal();
        }
    } catch (error) {
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

    // Populate the hotel selection dropdown on the guest form
    populateHotelsDropdown();
});

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
    const modal = document.getElementById('actionModal');
    const modalBox = document.getElementById('modalBox');
    modalBox.innerHTML = `
        <h3 style="margin-top: 0; color: #333;">Processing</h3>
        <p style="color: #666; margin: 15px 0;">${message}</p>
        <div class="loader"></div>
    `;
    modal.style.display = 'flex';
}

function closeModal() {
    document.getElementById('actionModal').style.display = 'none';
}