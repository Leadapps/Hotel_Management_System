// guest.js

// ⭐️ API_BASE_URL is relative, as the server serves this file.
const API_BASE_URL = '/api';
let currentHotelName = ''; // This will store the hotel name from the URL

// --- GUEST LOGIN & BOOKING ---
async function sendGuestOtp() {
    // const hotelName = document.getElementById('onlineHotelName').value; // <-- REMOVED
    const countryCode = document.getElementById('guestCountryCode').value.trim();
    const mobileNumber = document.getElementById('guestMobile').value.trim();

    if (!currentHotelName) {
        return alert('Hotel name not found in URL. Please use the correct booking link.');
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
    // const hotelName = document.getElementById('onlineHotelName').value; // <-- REMOVED
    if (!currentHotelName) {
        return alert('Hotel not found. Cannot check availability.');
    }

    try {
        const response = await fetch(`${API_BASE_URL}/hotels/availability?hotelName=${encodeURIComponent(currentHotelName)}`);
        if (!response.ok) {
            const err = await response.json();
            // Handle case where hotel name from URL is invalid
            if (response.status === 404) {
                 document.getElementById('guestLoginForm').innerHTML = `<h3>Booking Error</h3><p>The hotel "${currentHotelName}" could not be found. Please check your booking URL.</p>`;
            }
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
        hotelName: currentHotelName // <-- USE THE URL-DERIVED NAME
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
                <p>Please provide the Booking ID and Verification Code to confirm your room at the reception.</p>
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


// --- ⭐️ NEW: Get hotel name from URL on page load ---
document.addEventListener('DOMContentLoaded', function() {
    // Example URL: http://localhost:3000/book/The%20Grand%20Hotel
    // 1. Get pathname: "/book/The%20Grand%20Hotel"
    // 2. Split by '/': ["", "book", "The%20Grand%20Hotel"]
    // 3. Get last part: "The%20Grand%20Hotel"
    // 4. Decode: "The Grand Hotel"
    const pathParts = window.location.pathname.split('/');
    const hotelNameFromUrl = decodeURIComponent(pathParts[pathParts.length - 1] || '');

    if (hotelNameFromUrl) {
        currentHotelName = hotelNameFromUrl;
        document.title = `Book at ${currentHotelName}`;
        document.getElementById('hotelBookingTitle').textContent = `Book Your Stay at ${currentHotelName}`;
    } else {
         document.getElementById('guestLoginForm').innerHTML = '<h3>Error</h3><p>No hotel was specified in the URL.</p>';
    }
});