// script.js

const API_BASE_URL = 'https://hotel-management-system.vercel.app/api';

// --- STAFF LOGIN ---
async function login() {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value.trim();

    if (!username || !password) {
        return alert('Please enter both username and password.');
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
            alert(result.message || 'Invalid username or password.');
        }
    } catch (error) {
        console.error('Login failed:', error);
        alert('Could not connect to the server. Please ensure the server is running on http://localhost:3000');
    }
}

// --- GUEST LOGIN & BOOKING ---
async function sendGuestOtp() {
    const hotelName = document.getElementById('onlineHotelName').value;
    const countryCode = document.getElementById('guestCountryCode').value.trim();
    const mobileNumber = document.getElementById('guestMobile').value.trim();

    if (!hotelName) {
        return alert('Please select a hotel first.');
    }
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
    if (!otp || otp.length !== 6) {
        return alert('Please enter the 6-digit OTP.');
    }

    try {
        const response = await fetch(`${API_BASE_URL}/guest/verify-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ countryCode, mobileNumber, otp })
        });
        const result = await response.json();

        if (result.success) {
            alert('OTP Verified!');
            showBookingModal();
        } else {
            alert(result.message || 'Verification failed.');
        }
    } catch (error) {
        alert('An error occurred during verification.');
    }
}

async function showBookingModal() {
    const hotelName = document.getElementById('onlineHotelName').value;
    if (!hotelName) {
        return alert('Please select a hotel to see room availability.');
    }

    try {
        const response = await fetch(`${API_BASE_URL}/hotels/availability?hotelName=${encodeURIComponent(hotelName)}`);
        if (!response.ok) {
            const err = await response.json();
            return alert(err.message || 'Could not fetch room availability.');
        }
        const availableRooms = await response.json();

        document.getElementById('guestStep2').style.display = 'none';
        document.getElementById('guestStep3').style.display = 'block';
        
        // Display available rooms as a list
        const availabilityDiv = document.getElementById('roomAvailability');
        const roomList = availableRooms.map(r => `<li>${r.ROOM_NUMBER} (${r.ROOM_TYPE})</li>`).join('');
        availabilityDiv.innerHTML = `
            <p><strong>${availableRooms.length} rooms available.</strong></p>
            <ul style="list-style-type: none; padding-left: 0; margin-top: 5px; max-height: 100px; overflow-y: auto; text-align: left; border: 1px solid #eee; border-radius: 4px; padding: 5px;">
                ${roomList || '<li>No rooms available at the moment.</li>'}
            </ul>
        `;

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
        // The hotel name is hardcoded here. A real app might have a selection.
        hotelName: document.getElementById('onlineHotelName').value 
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
            const bookingConfirmation = `
                <h3>Booking Successful!</h3>
                <p>Thank you, ${bookingData.guestName}.</p>
                <p>Your Booking ID is: <strong>${result.bookingId}</strong></p>
                <p>Please provide the Booking ID and Verification Code  to confirm your room at the reception.</p>
                <button onclick="window.location.reload()">Book Another Room</button>
            `;
            document.getElementById('guestLoginForm').innerHTML = bookingConfirmation;
        } else {
            alert(result.message || 'Booking failed.');
        }
    } catch (error) {
        alert('An error occurred while booking.');
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