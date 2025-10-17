// public/script.js

const API_BASE_URL = '/api';

// Get hotel name from the global object injected by the server.
const hotelName = window.HOTEL_CONFIG ? window.HOTEL_CONFIG.name : null;

document.addEventListener('DOMContentLoaded', () => {
    if (hotelName) {
        document.getElementById('formTitle').textContent = `🏨 ${hotelName}`;
        document.getElementById('guestBookingTitle').textContent = `Book a Room at ${hotelName}`;
    } else {
        document.getElementById('formTitle').textContent = '🏨 Welcome to HMS';
        document.getElementById('guestLoginForm').innerHTML = '<p>Please access your hotel via its dedicated guest URL.</p>';
        document.getElementById('loginForm').innerHTML = '<p>Please access your hotel via its dedicated staff URL.</p>';
    }

    const passwordField = document.getElementById('loginPassword');
    if (passwordField) {
        passwordField.addEventListener('keypress', (event) => {
            if (event.key === 'Enter') login();
        });
    }
});

function showForm(formId) {
    document.querySelectorAll('.auth-form').forEach(form => form.style.display = 'none');
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));

    if (hotelName) {
        document.getElementById(formId).style.display = 'block';
    }

    if (formId === 'loginForm') {
        document.getElementById('employeeTabBtn').classList.add('active');
    } else {
        document.getElementById('guestTabBtn').classList.add('active');
    }
}

async function login() {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value.trim();
    if (!username || !password) return alert('Please enter both username and password.');

    try {
        const response = await fetch(`${API_BASE_URL}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const user = await response.json();
        if (response.ok) {
            if (user.hotelName !== hotelName) {
                return alert('Login failed. Please use the correct staff URL for your hotel.');
            }
            localStorage.setItem('hmsCurrentUser', JSON.stringify(user));
            window.location.href = "dashboard.html";
        } else {
            alert(user.message || 'Invalid username or password.');
        }
    } catch (error) {
        console.error('Login failed:', error);
        alert('Could not connect to the server.');
    }
}

async function sendGuestOtp() {
    if (!hotelName) return alert('Hotel not identified. Please use the correct URL.');

    const countryCode = document.getElementById('guestCountryCode').value.trim();
    const mobileNumber = document.getElementById('guestMobile').value.trim();
    if (!countryCode || !mobileNumber || !/^\d{10}$/.test(mobileNumber)) {
        return alert('Please enter a valid country code and 10-digit mobile number.');
    }

    try {
        const response = await fetch(`${API_BASE_URL}/guest/send-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ countryCode, mobileNumber })
        });
        const result = await response.json();
        alert(result.message);
        if (response.ok) {
            document.getElementById('guestStep1').style.display = 'none';
            document.getElementById('guestStep2').style.display = 'block';
            document.getElementById('guestOtp').focus();
        }
    } catch (error) {
        alert('Failed to send OTP. Please try again later.');
    }
}

async function verifyGuestOtp() {
    const countryCode = document.getElementById('guestCountryCode').value.trim();
    const mobileNumber = document.getElementById('guestMobile').value.trim();
    const otp = document.getElementById('guestOtp').value.trim();
    if (!otp || otp.length !== 6) return alert('Please enter the 6-digit OTP.');

    try {
        const response = await fetch(`${API_BASE_URL}/guest/verify-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ countryCode, mobileNumber, otp })
        });
        const result = await response.json();
        if (result.success) {
            alert('OTP Verified!');
            await showBookingModal();
        } else {
            alert(result.message || 'Verification failed.');
        }
    } catch (error) {
        alert('An error occurred during verification.');
    }
}

async function showBookingModal() {
    if (!hotelName) return;
    try {
        const response = await fetch(`${API_BASE_URL}/hotels/availability?hotelName=${encodeURIComponent(hotelName)}`);
        if (!response.ok) throw new Error('Could not fetch room availability.');

        const availableRooms = await response.json();
        document.getElementById('guestStep2').style.display = 'none';
        document.getElementById('guestStep3').style.display = 'block';
        
        document.getElementById('roomAvailability').innerHTML = `<p><strong>${availableRooms.length} rooms available.</strong></p>`;

        const roomTypeSelect = document.getElementById('onlineRoomType');
        const uniqueRoomTypes = [...new Set(availableRooms.map(r => r.ROOM_TYPE))];
        roomTypeSelect.innerHTML = '<option value="">Select Room Type</option>';
        uniqueRoomTypes.forEach(type => {
            const option = document.createElement('option');
            option.value = type;
            option.textContent = type;
            roomTypeSelect.appendChild(option);
        });
        document.getElementById('onlineGuestName').focus();
    } catch (error) {
        console.error('Error fetching availability:', error);
        alert('A network error occurred while checking for rooms.');
    }
}

async function bookRoomOnline() {
    const bookingData = {
        guestName: document.getElementById('onlineGuestName').value.trim(),
        countryCode: document.getElementById('guestCountryCode').value.trim(),
        mobileNumber: document.getElementById('guestMobile').value.trim(),
        roomType: document.getElementById('onlineRoomType').value,
        hotelName: hotelName
    };
    if (!bookingData.guestName || !bookingData.roomType) {
        return alert('Please enter your name and select a room type.');
    }
    try {
        const response = await fetch(`${API_BASE_URL}/online-bookings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bookingData)
        });
        const result = await response.json();
        if (response.ok) {
            const confirmationHtml = `
                <h3>Booking Successful!</h3>
                <p>Thank you, ${bookingData.guestName}. Your Booking ID is: <strong>${result.bookingId}</strong></p>
                <p>Please provide this ID at the reception to confirm your check-in.</p>
                <button onclick="window.location.reload()">Done</button>`;
            document.getElementById('guestLoginForm').innerHTML = confirmationHtml;
        } else {
            alert(result.message || 'Booking failed.');
        }
    } catch (error) {
        alert('An error occurred while booking.');
    }
}