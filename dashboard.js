// --- CONFIG & USER SESSION ---
const user = JSON.parse(localStorage.getItem('hmsCurrentUser'));
if (!user) window.location.href = "index.html";
document.getElementById('userInfo').textContent = `${user.fullName} (${user.role})`;
document.getElementById('sidebarHotelName').textContent = user.hotelName || 'Hotel';

const API_BASE_URL = 'https://hotel-management-system.vercel.app/api';

// --- APP STATE ---
let editingRoomNumber = null;
let editingGuestId = null;

// --- ROLE-BASED ACCESS CONTROL ---
function applyUIPermissions() {
    // Only owners see the Access Management tab
    if (user.role !== 'Owner') {
        document.getElementById('accessNav').style.display = 'none';
    }

    // Employees have specific UI restrictions based on their role and permissions
    if (user.role === 'Employee') {
        // These tabs are always hidden for Employees
        document.getElementById('billingNav').style.display = 'none';
        document.getElementById('historyNav').style.display = 'none';
        document.getElementById('accessNav').style.display = 'none'; // Redundant but safe

        // Control visibility of the "Rooms" tab and its form
        if (!user.permissions?.manageRooms) {
            document.getElementById('roomsNav').style.display = 'none';
            document.getElementById('addRoomForm').style.display = 'none';
        }

        // Control visibility of the "Check-in" tab. The tab is for adding guests.
        if (!user.permissions?.addGuests) {
            document.getElementById('checkinNav').style.display = 'none';
        }
    }
}


// --- UI HELPERS ---
const sidebar = document.querySelector('.sidebar');
sidebar.addEventListener('mouseenter', () => sidebar.classList.remove('collapsed'));
sidebar.addEventListener('mouseleave', () => sidebar.classList.add('collapsed'));
sidebar.classList.add('collapsed');

function openTab(tabId, elem) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active-tab'));
    document.getElementById(tabId).classList.add('active-tab');
    document.querySelectorAll('.sidebar ul li').forEach(li => li.classList.remove('active'));
    elem.classList.add('active');
}

function logout() {
    showModal("Are you sure you want to logout?", () => {
        localStorage.removeItem('hmsCurrentUser');
        window.location.href = "index.html";
    });
}

// --- MODAL DIALOG ---
// MODIFICATION: This function is rewritten to be more robust.
function showModal(message, onConfirm) {
    const modal = document.getElementById('actionModal');
    const modalBox = document.getElementById('modalBox');

    // **CRITICAL FIX**: Always reset the modal's innerHTML to its default structure.
    // This guarantees that the necessary elements (modalMessage, confirmBtn, cancelBtn) exist
    // before we try to add event listeners to them.
    modalBox.innerHTML = `
        <h3 id="modalMessage"></h3>
        <div class="modal-buttons">
          <button class="confirm-btn" id="confirmBtn">Yes</button>
          <button class="cancel-btn" id="cancelBtn">No</button>
        </div>
    `;

    // Now that we've guaranteed the elements exist, we can safely access them.
    document.getElementById('modalMessage').textContent = message;
    const confirmBtn = document.getElementById('confirmBtn');
    const cancelBtn = document.getElementById('cancelBtn');

    // Logic for showing/hiding confirm button and setting up callbacks
    if (onConfirm) {
        confirmBtn.style.display = 'inline-block';
        cancelBtn.textContent = 'No';
        
        // Assign the new action to the confirm button
        confirmBtn.onclick = () => {
            closeModal();
            onConfirm();
        };

    } else {
        // This is for simple alerts where only an "OK" button is needed.
        confirmBtn.style.display = 'none';
        cancelBtn.textContent = 'OK';
    }

    cancelBtn.onclick = () => closeModal();

    modal.style.display = 'flex';
}

function closeModal() {
    document.getElementById('actionModal').style.display = 'none';
    // It's good practice to clear the content so it doesn't show old data briefly
    // if opened again for another purpose.
    document.getElementById('modalBox').innerHTML = ''; 
}


// --- ONLINE BOOKING MANAGEMENT ---
async function renderOnlineBookings() {
    try {
        const response = await fetch(`${API_BASE_URL}/online-bookings?hotelName=${encodeURIComponent(user.hotelName)}`);
        const bookings = await response.json();

        const table = document.getElementById('onlineBookingTable');
        document.getElementById('totalOnlineBookings').textContent = bookings.length;

        if (bookings.length === 0) {
            table.innerHTML = '<tr><td colspan="4">No pending online bookings.</td></tr>';
            return;
        }

        table.innerHTML = bookings.map(b => `
            <tr>
                <td>${b.BOOKING_ID}</td>
                <td>${b.GUEST_NAME}</td>
                <td>${b.ROOM_TYPE}</td>
                <td class="actions-cell">
                    <button class="confirm-btn" onclick="acceptBooking(${b.BOOKING_ID})">
                        <i class="fa-solid fa-check"></i> Accept
                    </button>
                    <button class="delete-btn" onclick="declineBooking(${b.BOOKING_ID})">
                        <i class="fa-solid fa-times"></i> Decline
                    </button>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Failed to fetch online bookings:', error);
        document.getElementById('onlineBookingTable').innerHTML = '<tr><td colspan="4">Error loading bookings.</td></tr>';
    }
}

async function acceptBooking(bookingId) {
    showModal(`This will send an OTP to the guest for verification. Continue?`, async () => {
        try {
            // 1. Send the OTP to the guest first
            const otpResponse = await fetch(`${API_BASE_URL}/online-bookings/send-accept-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bookingId, hotelName: user.hotelName })
            });
            const otpResult = await otpResponse.json();
            if (!otpResponse.ok) {
                return showModal(otpResult.message || 'Failed to send OTP.');
            }

            // 2. If OTP is sent, show the modal to enter it
            const modal = document.getElementById('actionModal');
            const modalBox = document.getElementById('modalBox');
            modalBox.innerHTML = `
                <h3 style="margin-top:0;">Confirm Booking #${bookingId}</h3>
                <p>An OTP has been sent to the guest. Please enter it below, along with their details, to confirm check-in.</p>
                <input type="text" id="guestCheckinOtp" placeholder="Guest OTP" style="width: 100%; padding: 8px; margin: 8px 0; box-sizing: border-box;" maxlength="6" autofocus>
                <input type="number" id="onlineGuestAge" placeholder="Guest Age" style="width: 100%; padding: 8px; margin: 8px 0; box-sizing: border-box;">
                <select id="onlineGuestGender" style="width: 100%; padding: 8px; margin: 8px 0; box-sizing: border-box;">
                    <option value="">Select Gender</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                </select>
                <select id="onlineGuestVerificationType" style="width: 100%; padding: 8px; margin: 8px 0; box-sizing: border-box;">
                    <option value="">Select Verification ID Type</option>
                    <option value="Aadhaar Card">Aadhaar Card</option>
                    <option value="PAN Card">PAN Card</option>
                    <option value="Driving License">Driving License</option>
                    <option value="Passport">Passport</option>
                    <option value="Other">Other</option>
                </select>
                <input type="text" id="onlineGuestVerificationId" placeholder="Verification ID Number" style="width: 100%; padding: 8px; margin: 8px 0; box-sizing: border-box;">
                <div style="margin-top: 15px; display: flex; gap: 10px; justify-content: center;">
                    <button class="confirm-btn" onclick="confirmOnlineBooking(${bookingId})">Confirm Check-in</button>
                    <button class="cancel-btn" onclick="closeModal()">Cancel</button>
                </div>
            `;
            modal.style.display = 'flex';

        } catch (error) {
            showModal('A network error occurred while sending the OTP.');
        }
    });
}

async function confirmOnlineBooking(bookingId) {
    const guestOtp = document.getElementById('guestCheckinOtp').value;
    const age = document.getElementById('onlineGuestAge').value;
    const gender = document.getElementById('onlineGuestGender').value;
    const verificationIdType = document.getElementById('onlineGuestVerificationType').value;
    const verificationId = document.getElementById('onlineGuestVerificationId').value;

    if (!guestOtp || guestOtp.length !== 6 || !age || !gender || !verificationIdType || !verificationId) {
        return alert('Please fill all fields: OTP, age, gender, and verification details.');
    }

    try {
        const response = await fetch(`${API_BASE_URL}/online-bookings/confirm`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                bookingId,
                guestOtp,
                hotelName: user.hotelName,
                age: age,
                gender: gender,
                verificationIdType: verificationIdType,
                verificationId: verificationId
            })
        });

        const result = await response.json();
        closeModal();
        showModal(result.message || 'An error occurred.');

        if (response.ok) {
            renderOnlineBookings();
            renderGuestsAndBookings();
            renderRooms();
        }
    } catch (error) {
        console.error('Error confirming booking:', error);
        closeModal();
        showModal('A network error occurred.');
    }
}

function declineBooking(bookingId) {
    showModal(`Are you sure you want to decline booking #${bookingId}? This will notify the guest.`, async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/online-bookings/decline`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    bookingId,
                    hotelName: user.hotelName
                })
            });

            const result = await response.json();
            showModal(result.message || 'An error occurred.');

            if (response.ok) {
                renderOnlineBookings(); // Refresh the list of pending bookings
            }
        } catch (error) {
            console.error('Error declining booking:', error);
            showModal('A network error occurred while declining the booking.');
        }
    });
}


// --- ROOM MANAGEMENT ---
async function renderRooms() {
    try {
        const response = await fetch(`${API_BASE_URL}/rooms?hotelName=${encodeURIComponent(user.hotelName)}`);
        const rooms = await response.json();
        const guestResponse = await fetch(`${API_BASE_URL}/guests?hotelName=${encodeURIComponent(user.hotelName)}`);
        const guests = await guestResponse.json();
        const occupiedRooms = new Set(guests.map(g => g.ROOM_NUMBER));

        const roomTable = document.getElementById('roomTable');
        const canManage = user.role === 'Owner' || user.permissions.manageRooms;

        if (rooms.length === 0) {
            roomTable.innerHTML = '<tr><td colspan="6">No rooms found. Add a room to get started.</td></tr>';
            return;
        }

        roomTable.innerHTML = rooms.map(room => {
            const isOccupied = occupiedRooms.has(room.ROOM_NUMBER);
            const actionButtons = canManage ? `
                <button class="edit-btn" onclick='editRoom(${JSON.stringify(room)})' ${isOccupied ? 'disabled' : ''} title="${isOccupied ? 'Cannot edit occupied room' : 'Edit Room'}"><i class="fa-solid fa-pen-to-square"></i></button>
                <button class="delete-btn" onclick="deleteRoom('${room.ROOM_NUMBER}')" ${isOccupied ? 'disabled' : ''} title="${isOccupied ? 'Cannot delete occupied room' : 'Delete Room'}"><i class="fa-solid fa-trash"></i></button>
            ` : 'No Access';

            return `
                <tr>
                    <td>${room.ROOM_TYPE}</td>
                    <td>${room.ROOM_NUMBER}</td>
                    <td>₹${room.COST_PER_HOUR}</td>
                    <td>₹${room.COST_PER_DAY}</td>
                    <td>${room.DISCOUNT_PERCENT}%</td>
                    <td class="actions-cell">${actionButtons}</td>
                </tr>
            `;
        }).join('');
    } catch (error) {
        console.error('Failed to fetch rooms:', error);
        document.getElementById('roomTable').innerHTML = '<tr><td colspan="6">Error loading rooms.</td></tr>';
    }
}

function editRoom(room) {
    editingRoomNumber = room.ROOM_NUMBER;
    document.getElementById('roomType').value = room.ROOM_TYPE;
    document.getElementById('roomNumber').value = room.ROOM_NUMBER;
    document.getElementById('costHour').value = room.COST_PER_HOUR;
    document.getElementById('costDay').value = room.COST_PER_DAY;
    document.getElementById('discount').value = room.DISCOUNT_PERCENT;
    document.getElementById('roomNumber').disabled = true;
    document.getElementById('roomSubmitBtnText').textContent = 'Update Room';
    document.getElementById('cancelRoomEditBtn').style.display = 'inline-block';
    document.getElementById('addRoomForm').scrollIntoView({ behavior: 'smooth' });
}

function cancelRoomEdit() {
    editingRoomNumber = null;
    document.getElementById('addRoomForm').reset();
    document.getElementById('roomNumber').disabled = false;
    document.getElementById('roomSubmitBtnText').textContent = 'Add Room';
    document.getElementById('cancelRoomEditBtn').style.display = 'none';
}

async function saveRoom() {
  const roomData = {
    type: document.getElementById('roomType').value,
    number: document.getElementById('roomNumber').value,
    costHour: +document.getElementById('costHour').value,
    costDay: +document.getElementById('costDay').value,
    discount: +document.getElementById('discount').value || 0,
    hotelName: user.hotelName
  };

  if (!roomData.type || !roomData.number || !roomData.costHour || !roomData.costDay) {
    return showModal('Please fill all required room details.');
  }

  const confirmMessage = editingRoomNumber
    ? `Are you sure you want to update room ${editingRoomNumber}?`
    : 'Are you sure you want to add this room?';

  const action = async () => {
    let url = `${API_BASE_URL}/rooms`;
    let method = 'POST';

    if (editingRoomNumber) {
      url = `${API_BASE_URL}/rooms/${editingRoomNumber}`;
      method = 'PUT';
    }

    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(roomData),
      });
      const result = await response.json();
      if (response.ok) {
        showModal(result.message || 'Room saved successfully!');
        cancelRoomEdit();
        renderRooms(); 
      } else {
        showModal(result.message || 'Failed to save room.');
      }
    } catch (error) {
      console.error('Error saving room:', error);
      showModal('A network error occurred. Please try again.');
    }
  };
  showModal(confirmMessage, action);
}

async function deleteRoom(roomNumber) {
    showModal(`Are you sure you want to delete room ${roomNumber}?`, async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/rooms/${roomNumber}?hotelName=${encodeURIComponent(user.hotelName)}`, { 
                method: 'DELETE' 
            });
            const result = await response.json();
            showModal(result.message);
            if (response.ok) renderRooms();
        } catch (error) {
            console.error('Error deleting room:', error);
            showModal('An error occurred while deleting the room.');
        }
    });
}

// --- GUEST & BOOKING MANAGEMENT ---
async function renderGuestsAndBookings() {
    try {
        const response = await fetch(`${API_BASE_URL}/guests?hotelName=${encodeURIComponent(user.hotelName)}`);
        const guests = await response.json();
        const guestTable = document.getElementById('guestTable');
        const bookingTable = document.getElementById('bookingTable');
        const canEditGuests = user.role === 'Owner' || user.permissions.editGuests;
 
        guestTable.innerHTML = guests.map(g => {
            const actionCell = canEditGuests ? `
              <td class="actions-cell">
                <button class="edit-btn" onclick='editGuest(${JSON.stringify(g)})'><i class="fa-solid fa-pen-to-square"></i> Edit</button>
              </td>` : '<td>No Access</td>';
            const fullMobile = `${g.COUNTRY_CODE || ''} ${g.MOBILE_NUMBER || 'N/A'}`;
            return `
              <tr>
                <td>${g.GUEST_NAME}</td>
                <td>${g.AGE || 'N/A'}</td>
                <td>${g.GENDER || 'N/A'}</td>
                <td>${fullMobile}</td>
                <td>${g.ROOM_NUMBER}</td>
                <td>${new Date(g.CHECK_IN_TIME).toLocaleString()}</td>
                <td>${g.VERIFICATION_ID_TYPE || 'N/A'}</td>
                <td>${g.VERIFICATION_ID || 'N/A'}</td>
                ${actionCell}
              </tr>`;
        }).join('');
        
        bookingTable.innerHTML = guests.map(g => `
            <tr>
                <td>${g.GUEST_NAME}</td>
                <td>${g.AGE || 'N/A'}</td>
                <td>${g.GENDER || 'N/A'}</td>
                <td>${g.MOBILE_NUMBER || 'N/A'}</td>
                <td>${g.ROOM_NUMBER}</td>
                <td>${new Date(g.CHECK_IN_TIME).toLocaleString()}</td>
                <td>${g.ROOM_TYPE || 'N/A'}</td>
                <td>₹${g.COST_PER_DAY || 'N/A'}</td>
                <td>${g.DISCOUNT_PERCENT || 0}%</td>
            </tr>`
        ).join('');
    } catch (error) {
        console.error('Failed to fetch guests:', error);
        showModal('Could not load guest data.');
    }
}

function editGuest(guest) {
    editingGuestId = guest.GUEST_ID;
    document.getElementById('guestName').value = guest.GUEST_NAME;
    document.getElementById('guestAge').value = guest.AGE;
    document.getElementById('guestGender').value = guest.GENDER;
    document.getElementById('guestCountryCode').value = guest.COUNTRY_CODE || '+91';
    document.getElementById('guestMobile').value = guest.MOBILE_NUMBER;
    document.getElementById('guestRoom').value = guest.ROOM_NUMBER;
    document.getElementById('guestVerificationType').value = guest.VERIFICATION_ID_TYPE || '';
    document.getElementById('guestVerificationId').value = guest.VERIFICATION_ID || '';
    const checkInDate = new Date(guest.CHECK_IN_TIME);
    const formattedDate = checkInDate.toISOString().slice(0, 16);
    document.getElementById('guestCheckIn').value = formattedDate;

    document.getElementById('guestSubmitBtnText').textContent = 'Update Guest';
    document.getElementById('cancelGuestEditBtn').style.display = 'inline-block';
    document.getElementById('addGuestForm').scrollIntoView({ behavior: 'smooth' });
}

function cancelGuestEdit() {
    editingGuestId = null;
    document.getElementById('addGuestForm').reset();
    document.getElementById('guestSubmitBtnText').textContent = 'Add Guest';
    document.getElementById('cancelGuestEditBtn').style.display = 'none';
}

async function saveGuest() {
    const guestData = {
        name: document.getElementById('guestName').value,
        age: document.getElementById('guestAge').value,
        gender: document.getElementById('guestGender').value,
        countryCode: document.getElementById('guestCountryCode').value,
        mobile: document.getElementById('guestMobile').value,
        room: document.getElementById('guestRoom').value,
        verificationIdType: document.getElementById('guestVerificationType').value,
        verificationId: document.getElementById('guestVerificationId').value,
        checkIn: document.getElementById('guestCheckIn').value,
        address: user.address || '', 
        hotelName: user.hotelName
    };

    if (!guestData.name || !guestData.room || !guestData.checkIn || !guestData.mobile) {
        return showModal('Please enter all guest details including check-in time!');
    }

    if (editingGuestId) {
        // If editing, just confirm and save without OTP
        showModal(`Are you sure you want to update this guest?`, () => updateGuestDetails(guestData));
    } else {
        // If adding a new guest, start OTP flow
        if (!guestData.countryCode || !/^\d{10}$/.test(guestData.mobile)) {
            return showModal('Please enter a valid country code and 10-digit mobile number for the guest.');
        }
        showModal(`This will send an OTP to the guest's mobile (${guestData.countryCode}${guestData.mobile}) for verification. Continue?`, async () => {
            try {
                const otpResponse = await fetch(`${API_BASE_URL}/guest/send-checkin-otp`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ countryCode: guestData.countryCode, mobile: guestData.mobile })
                });
                const otpResult = await otpResponse.json();
                if (!otpResponse.ok) {
                    return showModal(otpResult.message || 'Failed to send OTP.');
                }
                // Show OTP input modal
                promptForGuestOtp(guestData);
            } catch (error) {
                console.error('Error sending check-in OTP:', error);
                showModal('A network error occurred while sending OTP.');
            }
        });
    }
}

function promptForGuestOtp(guestData) {
    const modal = document.getElementById('actionModal');
    const modalBox = document.getElementById('modalBox');
    
    modalBox.innerHTML = `
        <h3 style="margin-top:0;">Verify Guest Check-in</h3>
        <p>An OTP was sent to ${guestData.countryCode}${guestData.mobile}. Please enter it below to complete the check-in.</p>
        <input type="text" id="manualCheckinOtp" placeholder="Guest OTP" style="width: 100%; padding: 8px; margin: 8px 0; box-sizing: border-box;" maxlength="6">
        <div style="margin-top: 15px; display: flex; gap: 10px; justify-content: center;">
            <button class="confirm-btn" id="confirmCheckinWithOtpBtn">Confirm Check-in</button>
            <button class="cancel-btn" onclick="closeModal()">Cancel</button>
        </div>
    `;

    document.getElementById('confirmCheckinWithOtpBtn').onclick = () => {
        const otp = document.getElementById('manualCheckinOtp').value;
        if (!otp || otp.length !== 6) {
            return alert('Please enter a valid 6-digit OTP.');
        }
        const finalGuestData = { ...guestData, otp };
        updateGuestDetails(finalGuestData);
    };
    
    modal.style.display = 'flex';
}

async function updateGuestDetails(guestData) {
    let url = `${API_BASE_URL}/guests`;
    let method = 'POST';
    if (editingGuestId) {
        url = `${API_BASE_URL}/guests/${editingGuestId}`;
        method = 'PUT';
    }

    try {
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(guestData)
        });
        const result = await response.json();
        closeModal();
        showModal(result.message || 'An error occurred.');
        if (response.ok) {
            cancelGuestEdit();
            renderGuestsAndBookings();
            renderRooms();
        }
    } catch (error) {
        console.error('Error saving guest:', error);
        closeModal();
        showModal('A network error occurred while saving guest details.');
    }
}

// --- BILLING & HISTORY ---
let currentBillData = null;

async function generateBill() {
    const roomNo = document.getElementById('billRoomNo').value.trim();
    if (!roomNo) return showModal('Please enter a room number to generate bill.');

    try {
        const guestsResponse = await fetch(`${API_BASE_URL}/guests?hotelName=${encodeURIComponent(user.hotelName)}`);
        const guests = await guestsResponse.json();
        const guestToCheckOut = guests.find(g => g.ROOM_NUMBER === roomNo);
        if (!guestToCheckOut) {
            return showModal(`No active guest found in room ${roomNo}.`);
        }
        
        const roomResponse = await fetch(`${API_BASE_URL}/rooms?hotelName=${encodeURIComponent(user.hotelName)}`);
        const rooms = await roomResponse.json();
        const room = rooms.find(r => r.ROOM_NUMBER === roomNo);
        if (!room) {
             return showModal(`Room details for ${roomNo} not found.`);
        }

        const checkIn = new Date(guestToCheckOut.CHECK_IN_TIME);
        const checkOut = new Date();
        const hours = Math.ceil((checkOut - checkIn) / 3600000);
        const days = Math.floor(hours / 24);
        const remHours = hours % 24;
        const grossAmount = (days * room.COST_PER_DAY) + (remHours * room.COST_PER_HOUR);
        const discountAmount = (grossAmount * room.DISCOUNT_PERCENT) / 100;
        const finalAmount = grossAmount - discountAmount;

        currentBillData = {
            guestId: guestToCheckOut.GUEST_ID,
            guestName: guestToCheckOut.GUEST_NAME,
            roomNumber: roomNo,
            checkInTime: checkIn.toLocaleString(),
            checkOutTime: checkOut.toLocaleString(),
            totalHours: hours,
            grossAmount: grossAmount,
            hotelName: user.hotelName,
            discountAmount: discountAmount,
            finalAmount: finalAmount
        };

        const billResult = document.getElementById('billResult');
        billResult.innerHTML = `
            <div class="bill-card">
                <h3>Bill Summary</h3>
                <p><strong>Guest Name:</strong> ${currentBillData.guestName}</p>
                <p><strong>Room Number:</strong> ${currentBillData.roomNumber}</p>
                <p><strong>Check-in:</strong> ${currentBillData.checkInTime}</p>
                <p><strong>Check-out:</strong> ${currentBillData.checkOutTime}</p>
                <p><strong>Total Hours:</strong> ${currentBillData.totalHours}</p>
                <hr>
                <p><strong>Gross Amount:</strong> ₹${currentBillData.grossAmount.toFixed(2)}</p>
                <p><strong>Discount (${room.DISCOUNT_PERCENT}%):</strong> - ₹${currentBillData.discountAmount.toFixed(2)}</p>
                <h4>Final Amount: ₹${currentBillData.finalAmount.toFixed(2)}</h4>
                <div style="margin-top: 20px; display: flex; gap: 10px; flex-wrap: wrap;">
                    <button class="main-btn" onclick="checkoutGuest()"><i class="fa-solid fa-check"></i> Confirm & Checkout</button>
                    <button class="main-btn" style="background: #17a2b8;" onclick="printBill()"><i class="fa-solid fa-print"></i> Print Bill</button>
                </div>
            </div>`;
    } catch (error) {
        console.error('Error generating bill:', error);
        showModal('Could not generate bill.');
    }
}

async function checkoutGuest() {
    if (!currentBillData) return showModal('Please generate bill first.');
    
    showModal(`Confirm checkout for ${currentBillData.guestName}?`, async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/billing/checkout`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ guestId: currentBillData.guestId, hotelName: currentBillData.hotelName })
            });

            const result = await response.json();
            if (response.ok) {
                showModal(`${result.message}\nFinal Bill: ₹${result.finalAmount.toFixed(2)}`);
                currentBillData = null;
                document.getElementById('billRoomNo').value = '';
                document.getElementById('billResult').innerHTML = '';
                renderGuestsAndBookings();
                renderHistory();
                renderRooms();
            } else {
                showModal(result.message || 'Checkout failed.');
            }
        } catch (error) {
            console.error('Checkout failed:', error);
            showModal('An error occurred during checkout.');
        }
    });
}

function printBill() {
    if (!currentBillData) return showModal('Please generate bill first.');
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <html><head><title>Bill - ${user.hotelName}</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                .bill-container { max-width: 600px; margin: 0 auto; border: 1px solid #ccc; padding: 20px; }
                h2 { text-align: center; color: #007bff; }
                .bill-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
                .bill-total { font-weight: bold; font-size: 18px; padding: 15px 0; }
            </style>
        </head><body>
            <div class="bill-container">
                <h2>${user.hotelName}</h2>
                <div class="bill-row"><strong>Guest Name:</strong> ${currentBillData.guestName}</div>
                <div class="bill-row"><strong>Room Number:</strong> ${currentBillData.roomNumber}</div>
                <div class="bill-row"><strong>Check-in:</strong> ${currentBillData.checkInTime}</div>
                <div class="bill-row"><strong>Check-out:</strong> ${currentBillData.checkOutTime}</div>
                <hr>
                <div class="bill-row"><strong>Gross Amount:</strong> ₹${currentBillData.grossAmount.toFixed(2)}</div>
                <div class="bill-row"><strong>Discount:</strong> - ₹${currentBillData.discountAmount.toFixed(2)}</div>
                <div class="bill-row bill-total">
                    <strong>Final Amount:</strong> <span>₹${currentBillData.finalAmount.toFixed(2)}</span>
                </div>
            </div>
        </body></html>`);
    printWindow.document.close();
    printWindow.print();
}

async function renderHistory() {
    const container = document.getElementById('historyContainer');
    try {
        const response = await fetch(`${API_BASE_URL}/history?hotelName=${encodeURIComponent(user.hotelName)}`);
        const history = await response.json();

        if (history.length === 0) {
            container.innerHTML = "<p>No billing history found.</p>";
            return;
        }

        container.innerHTML = `
            <table>
                <thead>
                    <tr><th>Guest</th><th>Room</th><th>Check-in</th><th>Check-out</th><th>Hours</th><th>Gross</th><th>Discount</th><th>Final</th></tr>
                </thead>
                <tbody>
                    ${history.map(b => `
                        <tr>
                            <td>${b.GUEST_NAME}</td>
                            <td>${b.ROOM_NUMBER}</td>
                            <td>${new Date(b.CHECK_IN_TIME).toLocaleString()}</td>
                            <td>${new Date(b.CHECK_OUT_TIME).toLocaleString()}</td>
                            <td>${b.TOTAL_HOURS}</td>
                            <td>₹${b.GROSS_AMOUNT.toFixed(2)}</td>
                            <td>₹${b.DISCOUNT_AMOUNT.toFixed(2)}</td>
                            <td>₹${b.FINAL_AMOUNT.toFixed(2)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>`;
    } catch (error) {
        console.error('Failed to fetch history:', error);
        container.innerHTML = "<p>Error loading history.</p>";
    }
}

// --- ACCESS MANAGEMENT (OWNER ONLY) ---
async function renderAccessTable() {
    if (user.role !== 'Owner') return;

    try {
        const response = await fetch(`${API_BASE_URL}/users?hotelName=${encodeURIComponent(user.hotelName)}`);
        const users = await response.json();
        const table = document.getElementById('accessTable');
        
        if (users.length === 0) {
            table.innerHTML = '<tr><td colspan="5">No employees found to manage.</td></tr>';
            return;
        }
        table.innerHTML = users.map(u => `
            <tr>
                <td>${u.FULL_NAME} (${u.ROLE})</td>
                <td>${u.ADDRESS || 'N/A'}</td>
                <td><label class="switch"><input type="checkbox" ${u.PERM_MANAGE_ROOMS === 1 ? 'checked' : ''} onchange="updateUserPermission(${u.USER_ID}, 'manageRooms', this.checked)"><span class="slider round"></span></label></td>
                <td><label class="switch"><input type="checkbox" ${u.PERM_ADD_GUESTS === 1 ? 'checked' : ''} onchange="updateUserPermission(${u.USER_ID}, 'addGuests', this.checked)"><span class="slider round"></span></label></td>
                <td><label class="switch"><input type="checkbox" ${u.PERM_EDIT_GUESTS === 1 ? 'checked' : ''} onchange="updateUserPermission(${u.USER_ID}, 'editGuests', this.checked)"><span class="slider round"></span></label></td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Failed to load access data:', error);
        document.getElementById('accessTable').innerHTML = '<tr><td colspan="5">Error loading users.</td></tr>';
    }
}

async function updateUserPermission(userId, permission, value) {
    try {
        const response = await fetch(`${API_BASE_URL}/users/${userId}/permissions`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [permission]: value })
        });
        const result = await response.json();
        showModal(result.message);
    } catch (error) {
        console.error('Error updating permission:', error);
        showModal('An error occurred while updating permission.');
        renderAccessTable(); // Re-render to show the old state
    }
}

function openCreateAccountModal() {
    const modal = document.getElementById('actionModal');
    const modalBox = document.getElementById('modalBox');
    modalBox.innerHTML = `
        <h3 style="margin-top:0;">Create New Employee Account</h3>
        <input type="text" id="newFullName" placeholder="Full Name" style="width: 100%; padding: 8px; margin: 8px 0; box-sizing: border-box;">
        <input type="text" id="newUsername" placeholder="Username" style="width: 100%; padding: 8px; margin: 8px 0; box-sizing: border-box;">
        <input type="password" id="newPassword" placeholder="Password" style="width: 100%; padding: 8px; margin: 8px 0; box-sizing: border-box;">
        <input type="text" id="newAddress" placeholder="Address" style="width: 100%; padding: 8px; margin: 8px 0; box-sizing: border-box;">
        <select id="newRole" style="width: 100%; padding: 8px; margin: 8px 0; box-sizing: border-box;">
            <option value="Employee">Employee</option>
            <option value="Manager">Manager</option>
        </select>
        <div style="margin-top: 15px; display: flex; gap: 10px; justify-content: center;">
            <button class="confirm-btn" onclick="createNewAccount()">Create Account</button>
            <button class="cancel-btn" onclick="closeModal()">Cancel</button>
        </div>
    `;
    modal.style.display = 'flex';
}

async function createNewAccount() {
    const accountData = {
        fullName: document.getElementById('newFullName').value.trim(),
        username: document.getElementById('newUsername').value.trim(),
        password: document.getElementById('newPassword').value.trim(),
        address: document.getElementById('newAddress').value.trim(),
        role: document.getElementById('newRole').value,
        hotelName: user.hotelName
    };
    if (!accountData.fullName || !accountData.username || !accountData.password) {
        return alert('Full Name, Username, and Password are required.');
    }
    try {
        const response = await fetch(`${API_BASE_URL}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(accountData)
        });
        const result = await response.json();
        if (response.ok) {
            closeModal();
            showModal('Account created successfully!');
            renderAccessTable();
        } else {
            alert(result.message || 'Failed to create account.');
        }
    } catch (error) {
        console.error('Error creating account:', error);
        alert('An error occurred while creating the account.');
    }
}


// --- INITIAL DATA LOAD ---
document.addEventListener('DOMContentLoaded', () => {
    applyUIPermissions();
    const firstVisibleTabLink = document.querySelector('.sidebar ul li:not([style*="display: none"])');
    if (firstVisibleTabLink) {
        const tabId = firstVisibleTabLink.getAttribute('onclick').match(/'([^']+)'/)[1];
        openTab(tabId, firstVisibleTabLink);
    }
    renderRooms();
    renderGuestsAndBookings();
    renderOnlineBookings();
    renderHistory();
    if (user.role === 'Owner') {
        renderAccessTable();
    }
});