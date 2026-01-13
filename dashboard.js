// --- CONFIG & USER SESSION ---
let user = JSON.parse(localStorage.getItem('hmsCurrentUser'));
if (!user) window.location.href = "index.html";

const userInfoEl = document.getElementById('userInfo');
const profilePicSrc = user.profilePicture || 'https://via.placeholder.com/40';
userInfoEl.innerHTML = `
    <div style="display: flex; align-items: center; gap: 10px;">
        <img src="${profilePicSrc}" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover; border: 2px solid rgba(255,255,255,0.5);">
        <div>
            <div style="font-weight: 600; font-size: 15px; line-height: 1.2;">${user.fullName}</div>
            <div style="font-size: 12px; opacity: 0.8; margin-top: 2px;">${user.role}</div>
        </div>
    </div>`;
userInfoEl.style.cursor = 'pointer';
userInfoEl.onclick = showUserDetails;

document.getElementById('sidebarHotelName').textContent = user.hotelName || 'Hotel';

const API_BASE_URL = 'http://localhost:3000/api';

// --- THEME MANAGEMENT ---
function injectDarkModeStyles() {
    const style = document.createElement('style');
    style.textContent = `
        body.dark-mode { background-color: #18191a; color: #e4e6eb; color-scheme: dark; }
        .dark-mode .sidebar { background-color: #242526; border-right: 1px solid #3a3b3c; }
        .dark-mode .sidebar ul li:hover, .dark-mode .sidebar ul li.active { background-color: #3a3b3c; }
        .dark-mode .main-content { background-color: #18191a; }
        .dark-mode .tab-content, .dark-mode .modal-content, .dark-mode .bill-card { background-color: #242526; color: #e4e6eb; box-shadow: 0 2px 10px rgba(0,0,0,0.5); }
        .dark-mode table { background-color: #242526; color: #e4e6eb; }
        .dark-mode th { background-color: #3a3b3c; color: #fff; border-bottom: 1px solid #4e4f50; }
        .dark-mode td { border-bottom: 1px solid #3a3b3c; }
        .dark-mode input, .dark-mode select, .dark-mode textarea { background-color: #3a3b3c; color: #e4e6eb; border: 1px solid #4e4f50; }
        .dark-mode input::placeholder, .dark-mode textarea::placeholder { color: #b0b3b8; }
        .dark-mode option { background-color: #3a3b3c; color: #e4e6eb; }
        .dark-mode h1, .dark-mode h2, .dark-mode h3, .dark-mode h4, .dark-mode p, .dark-mode label { color: #e4e6eb; }
        
        /* Autofill fix for dark mode */
        .dark-mode input:-webkit-autofill,
        .dark-mode input:-webkit-autofill:hover, 
        .dark-mode input:-webkit-autofill:focus, 
        .dark-mode input:-webkit-autofill:active {
            -webkit-box-shadow: 0 0 0 30px #3a3b3c inset !important;
            -webkit-text-fill-color: #e4e6eb !important;
            transition: background-color 5000s ease-in-out 0s;
        }
    `;
    document.head.appendChild(style);
}

function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
    const isDark = document.body.classList.contains('dark-mode');
    localStorage.setItem('hmsDarkMode', isDark);
    updateDarkModeButton(isDark);
}

function updateDarkModeButton(isDark) {
    const btn = document.getElementById('darkModeToggle');
    if (btn) {
        btn.innerHTML = isDark ? '<i class="fa-solid fa-sun"></i> Light Mode' : '<i class="fa-solid fa-moon"></i> Dark Mode';
    }
}

// --- APP STATE ---
let editingRoomNumber = null;
let editingGuestId = null;
let tempRoomPhotos = []; // Store existing photos during edit
let previousKitchenOrderIds = new Set();
let kitchenInitialized = false;
let previousHousekeepingIds = new Set();
let housekeepingInitialized = false;
const notificationSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');

let allMenuItems = [];
let currentMenuPage = 1;
const menuItemsPerPage = 5;
let menuSearchTerm = '';
let selectedMenuIds = new Set();
let editingMenuItemId = null;

let selectedHotel = null; // For Admin context
function getContextHotel() {
    return user.role === 'Admin' ? selectedHotel : user.hotelName;
}

// --- ROLE-BASED ACCESS CONTROL ---
async function applyUIPermissions() {
    // Redirect Room role to dine-in page if they access dashboard
    if (user.role === 'Room') {
        window.location.href = 'dinein.html';
        return;
    }

    // Admin Role Setup
    if (user.role === 'Admin') {
        await setupAdminUI();
        return;
    }

    // Only owners see the Access Management tab
    if (user.role !== 'Owner' && user.role !== 'Admin') {
        document.getElementById('accessNav').style.display = 'none';

        // Apply granular permissions for both Managers and Employees
        if (!user.permissions?.manageRooms) {
            document.getElementById('roomsNav').style.display = 'none';
            document.getElementById('addRoomForm').style.display = 'none';
        }

        // Control visibility of the "Check-in" tab.
        if (!user.permissions?.addGuests) {
            document.getElementById('checkinNav').style.display = 'none';
        }
    }
    
    // Special Roles: Chef, Waiter, Housekeeping
    if (user.role === 'Chef' || user.role === 'Waiter' || user.role === 'Housekeeping') {
        await setupSpecialRoleUI();
        return; // Stop standard rendering
    }

    // Employees have specific additional UI restrictions (Billing/History hidden)
    if (user.role === 'Employee') {
        document.getElementById('billingNav').style.display = 'none';
        document.getElementById('historyNav').style.display = 'none';
    }
}

async function setupSpecialRoleUI() {
    // Hide standard sidebar items
    const sidebarItems = document.querySelectorAll('.sidebar ul li');
    sidebarItems.forEach(li => li.style.display = 'none');
    
    // Hide standard content sections
    const contents = document.querySelectorAll('.tab-content');
    contents.forEach(c => c.style.display = 'none');

    const sidebarList = document.querySelector('.sidebar ul');
    
    if (user.role === 'Chef') {
        // Add Kitchen Tab
        const li = document.createElement('li');
        li.className = 'active';
        li.innerHTML = '<i class="fa-solid fa-fire-burner"></i> Kitchen';
        li.onclick = () => renderKitchenOrders();
        sidebarList.appendChild(li);
        
        // Create Kitchen Container
        const div = document.createElement('div');
        div.id = 'kitchenContainer';
        div.className = 'tab-content active-tab';
        div.innerHTML = '<h2>Kitchen Orders</h2><div id="kitchenOrdersList">Loading...</div>';
        document.querySelector('.main-content').appendChild(div);
        
        await renderKitchenOrders();
        setInterval(renderKitchenOrders, 10000); // Auto-refresh
    }
    
    if (user.role === 'Waiter') {
        // Add Delivery Tab
        const li = document.createElement('li');
        li.className = 'active';
        li.innerHTML = '<i class="fa-solid fa-bell-concierge"></i> Deliveries';
        li.onclick = () => renderDeliveryOrders();
        sidebarList.appendChild(li);
        
        // Create Delivery Container
        const div = document.createElement('div');
        div.id = 'deliveryContainer';
        div.className = 'tab-content active-tab';
        div.innerHTML = '<h2>Pending Deliveries</h2><div id="deliveryOrdersList">Loading...</div>';
        document.querySelector('.main-content').appendChild(div);
        
        await renderDeliveryOrders();
        setInterval(renderDeliveryOrders, 10000); // Auto-refresh
    }

    if (user.role === 'Housekeeping') {
        // Add Housekeeping Tab
        const li = document.createElement('li');
        li.className = 'active';
        li.innerHTML = '<i class="fa-solid fa-broom"></i> Housekeeping';
        li.onclick = () => renderHousekeepingRequests();
        sidebarList.appendChild(li);
        
        // Create Container
        const div = document.createElement('div');
        div.id = 'housekeepingContainer';
        div.className = 'tab-content active-tab';
        div.innerHTML = '<h2>Service Requests</h2><div id="housekeepingList">Loading...</div>';
        document.querySelector('.main-content').appendChild(div);
        
        await renderHousekeepingRequests();
        setInterval(renderHousekeepingRequests, 10000); // Auto-refresh
    }
}

async function setupAdminUI() {
    // 1. Inject Hotel Selector in Sidebar
    const sidebar = document.querySelector('.sidebar');
    const header = sidebar.querySelector('h2');
    
    const selectorContainer = document.createElement('div');
    selectorContainer.style.padding = '0 10px 15px 10px';
    selectorContainer.style.borderBottom = '1px solid rgba(255,255,255,0.1)';
    selectorContainer.style.marginBottom = '10px';

    const label = document.createElement('label');
    label.textContent = 'Select Hotel:';
    label.style.display = 'block';
    label.style.fontSize = '12px';
    label.style.marginBottom = '5px';
    label.style.opacity = '0.8';

    const select = document.createElement('select');
    select.id = 'adminHotelSelector';
    select.style.width = '100%';
    select.style.padding = '5px';
    select.style.borderRadius = '4px';
    select.style.border = 'none';
    select.style.fontSize = '13px';
    select.style.color = '#333';

    selectorContainer.appendChild(label);
    selectorContainer.appendChild(select);
    
    // Insert after the H2 header
    header.parentNode.insertBefore(selectorContainer, header.nextSibling);

    // 2. Add "Manage Owners" Tab to Sidebar
    const sidebarList = document.querySelector('.sidebar ul');
    const ownerLi = document.createElement('li');
    ownerLi.innerHTML = '<i class="fa-solid fa-user-tie"></i> Manage Owners';
    ownerLi.onclick = function() { openTab('ownerManagementContainer', this); renderOwnerManagement(); };
    // Insert at the top
    sidebarList.insertBefore(ownerLi, sidebarList.firstChild);

    // Create Container for Owner Management
    const div = document.createElement('div');
    div.id = 'ownerManagementContainer';
    div.className = 'tab-content';
    div.innerHTML = `
        <h2>Owner Management</h2>
        <div id="ownerList">Loading...</div>
    `;
    document.querySelector('.main-content').appendChild(div);

    // 3. Fetch Hotels and Populate Selector
    try {
        const response = await fetch(`${API_BASE_URL}/hotels`);
        const hotels = await response.json();
        
        if (hotels.length > 0) {
            selectedHotel = hotels[0]; // Default to first
            hotels.forEach(h => {
                const opt = document.createElement('option');
                opt.value = h;
                opt.textContent = h;
                select.appendChild(opt);
            });
        } else {
            const opt = document.createElement('option');
            opt.textContent = "No Hotels Found";
            select.appendChild(opt);
        }

        select.value = selectedHotel;
        select.onchange = (e) => {
            selectedHotel = e.target.value;
            // Refresh current view
            const activeTab = document.querySelector('.tab-content.active-tab');
            if (activeTab && activeTab.id !== 'ownerManagementContainer') {
                // Re-trigger the click on the active sidebar item to reload
                const activeLi = document.querySelector('.sidebar ul li.active');
                if (activeLi) activeLi.click();
            }
        };

        // Update sidebar hotel name display
        document.getElementById('sidebarHotelName').textContent = 'Admin Panel';

    } catch (e) {
        console.error("Failed to load hotels", e);
    }
}

async function renderOwnerManagement() {
    const container = document.getElementById('ownerList');
    setupHeaderAction('ownerList', 'addOwnerBtn', 'Create Owner Account', () => openCreateOwnerModal());
    
    try {
        const response = await fetch(`${API_BASE_URL}/admin/owners`);
        const owners = await response.json();
        
        if (owners.length === 0) {
            container.innerHTML = '<p>No owners found.</p>';
            return;
        }

        container.innerHTML = `
            <table>
                <thead>
                    <tr><th>Hotel Name</th><th>Owner Name</th><th>Email</th><th>Mobile</th><th>Address</th><th>Actions</th></tr>
                </thead>
                <tbody>
                    ${owners.map(o => `
                        <tr>
                            <td style="font-weight:bold; color:#007bff;">${o.HOTEL_NAME}</td>
                            <td>${o.FULL_NAME}</td>
                            <td>${o.EMAIL}</td>
                            <td>${o.MOBILE_NUMBER}</td>
                            <td>${o.ADDRESS || '-'}</td>
                            <td>
                                <button class="edit-btn" onclick='editOwner(${JSON.stringify(o).replace(/'/g, "&#39;")})' title="Edit Owner Details">
                                    <i class="fa-solid fa-pen"></i>
                                </button>
                                <button class="delete-btn" onclick="deleteOwner(${o.USER_ID}, '${o.FULL_NAME.replace(/'/g, "\\'")}')" title="Delete Owner Account">
                                    <i class="fa-solid fa-trash"></i>
                                </button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } catch (e) {
        container.innerHTML = '<p>Error loading owners.</p>';
    }
}

function editOwner(owner) {
    const modal = document.getElementById('actionModal');
    const modalBox = document.getElementById('modalBox');
    modalBox.innerHTML = `
        <h3 style="margin-top:0;">Edit Owner Details</h3>
        <input type="text" id="editOwnerName" placeholder="Full Name" value="${owner.FULL_NAME}" style="width: 100%; padding: 8px; margin: 8px 0; box-sizing: border-box;">
        <input type="email" id="editOwnerEmail" placeholder="Email" value="${owner.EMAIL}" style="width: 100%; padding: 8px; margin: 8px 0; box-sizing: border-box;">
        <input type="text" id="editOwnerMobile" placeholder="Mobile Number" value="${owner.MOBILE_NUMBER}" style="width: 100%; padding: 8px; margin: 8px 0; box-sizing: border-box;">
        <input type="text" id="editOwnerAddress" placeholder="Address" value="${owner.ADDRESS || ''}" style="width: 100%; padding: 8px; margin: 8px 0; box-sizing: border-box;">
        <p style="font-size:12px; color:#666;">Note: Hotel Name cannot be changed here.</p>
        
        <div style="margin-top: 15px; display: flex; gap: 10px; justify-content: center;">
            <button class="confirm-btn" onclick="submitOwnerEdit(${owner.USER_ID})">Save Changes</button>
            <button class="cancel-btn" onclick="closeModal()">Cancel</button>
        </div>
    `;
    modal.style.display = 'flex';
}

async function submitOwnerEdit(userId) {
    const updatedData = {
        fullName: document.getElementById('editOwnerName').value.trim(),
        email: document.getElementById('editOwnerEmail').value.trim(),
        mobile: document.getElementById('editOwnerMobile').value.trim(),
        address: document.getElementById('editOwnerAddress').value.trim()
    };

    try {
        showLoading("Updating owner details...");
        const response = await fetch(`${API_BASE_URL}/users/${userId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedData)
        });
        const result = await response.json();
        showModal(result.message);
        if (response.ok) {
            renderOwnerManagement();
        }
    } catch (error) {
        console.error('Error updating owner:', error);
        showModal('Failed to update owner details.');
    }
}

async function deleteOwner(userId, name) {
    showModal(`Are you sure you want to delete the account for ${name}?\nThis will NOT delete the hotel data, only the owner's login.`, async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/admin/owners/${userId}`, { method: 'DELETE' });
            const result = await response.json();
            showModal(result.message);
            if (response.ok) renderOwnerManagement();
        } catch (e) {
            showModal('Failed to delete owner.');
        }
    });
}

function openCreateOwnerModal() {
    const modal = document.getElementById('actionModal');
    const modalBox = document.getElementById('modalBox');
    modalBox.innerHTML = `
        <h3 style="margin-top:0;">Create Owner & Hotel</h3>
        <p style="font-size:12px; color:#666;">This will create a new Owner account and register a new Hotel.</p>
        <input type="text" id="newOwnerHotel" placeholder="Hotel Name" style="width: 100%; padding: 8px; margin: 8px 0; box-sizing: border-box;">
        <input type="text" id="newOwnerName" placeholder="Owner Full Name" style="width: 100%; padding: 8px; margin: 8px 0; box-sizing: border-box;">
        <input type="email" id="newOwnerEmail" placeholder="Email" style="width: 100%; padding: 8px; margin: 8px 0; box-sizing: border-box;">
        <input type="text" id="newOwnerMobile" placeholder="Mobile Number" style="width: 100%; padding: 8px; margin: 8px 0; box-sizing: border-box;">
        <input type="text" id="newOwnerAddress" placeholder="Address" style="width: 100%; padding: 8px; margin: 8px 0; box-sizing: border-box;">
        
        <div style="margin-top: 15px; display: flex; gap: 10px; justify-content: center;">
            <button class="confirm-btn" onclick="saveOwner()">Create Account</button>
            <button class="cancel-btn" onclick="closeModal()">Cancel</button>
        </div>
    `;
    modal.style.display = 'flex';
}

async function saveOwner() {
    const accountData = {
        fullName: document.getElementById('newOwnerName').value.trim(),
        email: document.getElementById('newOwnerEmail').value.trim(),
        mobile: document.getElementById('newOwnerMobile').value.trim(),
        address: document.getElementById('newOwnerAddress').value.trim(),
        hotelName: document.getElementById('newOwnerHotel').value.trim(),
        role: 'Owner'
    };

    if (!accountData.fullName || !accountData.email || !accountData.mobile || !accountData.hotelName) {
        return showModal('All fields are required.');
    }

    try {
        showLoading("Creating owner account...");
        const response = await fetch(`${API_BASE_URL}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(accountData)
        });
        const result = await response.json();
        if (response.ok) {
            closeModal();
            showModal('Owner account created successfully!');
            renderOwnerManagement();
            // Refresh hotel selector if needed (requires page reload or complex logic, simple reload is easier)
            setTimeout(() => location.reload(), 2000); 
        } else {
            showModal(result.message || 'Failed to create account.');
        }
    } catch (error) {
        console.error('Error creating owner:', error);
        showModal('An error occurred.');
    }
}

async function updateOrderStatus(orderId, newStatus) {
    try {
        await fetch(`${API_BASE_URL}/food-orders/${orderId}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ status: newStatus })
        });
        if (user.role === 'Chef') renderKitchenOrders();
        if (user.role === 'Waiter') renderDeliveryOrders();
    } catch (e) {
        console.error("Failed to update order", e);
    }
}

async function renderHousekeepingRequests() {
    const container = document.getElementById('housekeepingList');
    try {
        const response = await fetch(`${API_BASE_URL}/service-requests?status=Pending`);
        const requests = await response.json();

        const currentIds = new Set(requests.map(r => r.ID));
        if (housekeepingInitialized) {
            const hasNew = requests.some(r => !previousHousekeepingIds.has(r.ID));
            if (hasNew) {
                notificationSound.currentTime = 0;
                notificationSound.play().catch(e => console.warn("Sound blocked:", e));
            }
        } else {
            housekeepingInitialized = true;
        }
        previousHousekeepingIds = currentIds;
        
        if (requests.length === 0) {
            container.innerHTML = '<p>No pending requests.</p>';
            return;
        }

        container.innerHTML = requests.map(r => `
            <div class="bill-card" style="text-align:left; margin-bottom:15px; border-left: 5px solid #17a2b8;">
                <div style="display:flex; justify-content:space-between;">
                    <h3>Room: ${r.ROOM_NUMBER}</h3>
                    <span>${new Date(r.CREATED_AT).toLocaleTimeString()}</span>
                </div>
                <p><strong>Type:</strong> ${r.REQUEST_TYPE}</p>
                ${r.COMMENTS ? `<p><strong>Note:</strong> ${r.COMMENTS}</p>` : ''}
                <button class="confirm-btn" onclick="updateServiceRequestStatus(${r.ID}, 'Completed')">Mark Completed</button>
            </div>
        `).join('');
    } catch (e) {
        container.innerHTML = '<p>Waiting for requests...</p>';
    }
}

async function updateServiceRequestStatus(id, status) {
    try {
        await fetch(`${API_BASE_URL}/service-requests/${id}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ status })
        });
        renderHousekeepingRequests();
    } catch (e) {
        console.error("Failed to update request", e);
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
    if (user.role === 'Room') return; // Prevent logout for Room users
    showModal("Are you sure you want to logout?", () => {
        localStorage.removeItem('hmsCurrentUser');
        window.location.href = "index.html";
    });
}

function openChangePasswordModal() {
    const modal = document.getElementById('actionModal');
    const modalBox = document.getElementById('modalBox');
    modalBox.innerHTML = `
        <h3 style="margin-top:0;">Change Password</h3>
        <input type="password" id="currentPassword" placeholder="Current Password" style="width: 100%; padding: 8px; margin: 8px 0; box-sizing: border-box;">
        <input type="password" id="newPassword" placeholder="New Password" style="width: 100%; padding: 8px; margin: 8px 0; box-sizing: border-box;">
        <input type="password" id="confirmNewPassword" placeholder="Confirm New Password" style="width: 100%; padding: 8px; margin: 8px 0; box-sizing: border-box;">
        <p id="changePassError" style="color: red; font-size: 13px; margin: 5px 0; min-height: 18px;"></p>
        <div style="margin-top: 15px; display: flex; gap: 10px; justify-content: center;">
            <button class="confirm-btn" onclick="submitChangePassword()">Update</button>
            <button class="cancel-btn" onclick="closeModal()">Cancel</button>
        </div>
    `;
    modal.style.display = 'flex';
}

async function submitChangePassword() {
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmNewPassword = document.getElementById('confirmNewPassword').value;
    const errorMsg = document.getElementById('changePassError');

    if (!currentPassword || !newPassword || !confirmNewPassword) {
        errorMsg.textContent = 'All fields are required.';
        return;
    }

    if (newPassword !== confirmNewPassword) {
        errorMsg.textContent = 'New passwords do not match.';
        return;
    }

    try {
        showLoading("Updating password...");
        const response = await fetch(`${API_BASE_URL}/users/change-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: user.username, currentPassword, newPassword })
        });
        const result = await response.json();
        showModal(result.message || (response.ok ? 'Password updated successfully!' : 'Failed to update password.'));
    } catch (error) {
        console.error(error);
        showModal('An error occurred.');
    }
}

// --- MODAL DIALOG ---
// MODIFICATION: This function is rewritten to be more robust.
function showModal(message, onConfirm, onCancel) {
    const modal = document.getElementById('actionModal');
    const modalBox = document.getElementById('modalBox');
    const title = onConfirm ? 'Confirmation' : 'Notification';

    // **CRITICAL FIX**: Always reset the modal's innerHTML to its default structure.
    // This guarantees that the necessary elements (modalMessage, confirmBtn, cancelBtn) exist
    // before we try to add event listeners to them.
    modalBox.innerHTML = `
        <h3 style="margin-top:0;">${title}</h3>
        <p id="modalMessage" style="color:#555; margin:15px 0; white-space: pre-wrap;"></p>
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
        
        cancelBtn.onclick = () => {
            closeModal();
            if (onCancel) onCancel();
        };

    } else {
        // This is for simple alerts where only an "OK" button is needed.
        confirmBtn.style.display = 'none';
        cancelBtn.textContent = 'OK';
        cancelBtn.onclick = () => closeModal();
    }

    modal.style.display = 'flex';
}

function closeModal() {
    document.getElementById('actionModal').style.display = 'none';
    // It's good practice to clear the content so it doesn't show old data briefly
    // if opened again for another purpose.
    document.getElementById('modalBox').innerHTML = ''; 
}

function showLoading(message) {
    const modal = document.getElementById('actionModal');
    const modalBox = document.getElementById('modalBox');
    
    // Inject CSS for spinner if not present
    if (!document.getElementById('loaderStyles')) {
        const style = document.createElement('style');
        style.id = 'loaderStyles';
        style.innerHTML = `
            .custom-loader { width: 50px; height: 50px; border: 5px solid #f3f3f3; border-top: 5px solid #007bff; border-radius: 50%; animation: spin 1s linear infinite; margin: 20px auto; }
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
            .loading-text { font-size: 18px; color: #555; font-weight: 500; animation: pulse 1.5s infinite ease-in-out; }
            @keyframes pulse { 0% { opacity: 0.6; } 50% { opacity: 1; } 100% { opacity: 0.6; } }
        `;
        document.head.appendChild(style);
    }

    modalBox.innerHTML = `
        <div style="text-align: center; padding: 20px;">
            <div class="custom-loader"></div>
            <p class="loading-text">${message}</p>
        </div>
    `;
    modal.style.display = 'flex';
}

// --- UI HELPER: HEADER ACTIONS ---
function setupHeaderAction(tableId, buttonId, buttonText, onClick) {
    const table = document.getElementById(tableId);
    if (!table) return;
    
    // Check if button already exists to prevent duplicates
    if (document.getElementById(buttonId)) return;

    // Strategy: Find the section header (h2/h3) relative to the table.
    // The table might be inside a wrapper (e.g. .table-responsive), so we traverse up.
    let container = table.parentElement;
    let header = null;
    
    // Traverse up to 3 levels to find a container that has a header
    for (let i = 0; i < 3; i++) {
        if (!container) break;
        
        // Find the header (h2 or h3). We removed the visibility check (offsetParent) 
        // so that buttons are correctly added to tabs even when they are initially hidden.
        const headers = container.querySelectorAll('h2, h3');
        for (let h of headers) {
            // Avoid selecting headers that might be inside the hidden static forms
            if (h.closest('#addRoomForm') || h.closest('#addGuestForm')) continue;
            
            header = h;
            break;
        }
        
        if (header) break;
        container = container.parentElement;
    }

    if (header) {
        // Found a header. Check if we already created a wrapper for it.
        let wrapper = header.parentElement;
        let btnContainer = wrapper.querySelector('.header-actions-container');

        if (!btnContainer) {
            // Create a flex wrapper to align Header (left) and Button Container (right).
            wrapper = document.createElement('div');
            wrapper.className = 'header-action-wrapper';
            wrapper.style.display = 'flex';
            wrapper.style.justifyContent = 'space-between';
            wrapper.style.alignItems = 'center';
            wrapper.style.marginBottom = '15px';
            
            header.parentNode.insertBefore(wrapper, header);
            wrapper.appendChild(header);
            header.style.margin = '0';

            // Create container for buttons
            btnContainer = document.createElement('div');
            btnContainer.className = 'header-actions-container';
            btnContainer.style.display = 'flex';
            btnContainer.style.gap = '10px';
            wrapper.appendChild(btnContainer);
        }
        
        const btn = document.createElement('button');
        btn.id = buttonId;
        btn.className = 'main-btn';
        
        // Determine icon based on text
        let icon = 'fa-plus';
        if (buttonText.toLowerCase().includes('delete')) icon = 'fa-trash';
        else if (buttonText.toLowerCase().includes('bulk')) icon = 'fa-layer-group';
        
        btn.innerHTML = `<i class="fa-solid ${icon}"></i> ${buttonText}`;
        btn.onclick = onClick;
        
        btnContainer.appendChild(btn);
    } else {
        // Fallback: No header found. Insert button above the table aligned right.
        let toolbar = document.getElementById(tableId + '_toolbar');
        if (!toolbar) {
            toolbar = document.createElement('div');
            toolbar.id = tableId + '_toolbar';
            toolbar.style.display = 'flex';
            toolbar.style.justifyContent = 'flex-end';
            toolbar.style.gap = '10px';
            toolbar.style.marginBottom = '15px';
            
            // Insert before the table's immediate parent (assuming it's the scroll wrapper)
            // or the table itself if no wrapper.
            const insertTarget = table.parentElement.classList.contains('table-responsive') ? table.parentElement : table;
            insertTarget.parentNode.insertBefore(toolbar, insertTarget);
        }

        const btn = document.createElement('button');
        btn.id = buttonId;
        btn.className = 'main-btn';
        
        let icon = 'fa-plus';
        if (buttonText.toLowerCase().includes('delete')) icon = 'fa-trash';
        else if (buttonText.toLowerCase().includes('bulk')) icon = 'fa-layer-group';

        btn.innerHTML = `<i class="fa-solid ${icon}"></i> ${buttonText}`;
        btn.onclick = onClick;
        
        toolbar.appendChild(btn);
    }
}

// --- ONLINE BOOKING MANAGEMENT ---
async function renderOnlineBookings() {
    try {
        const response = await fetch(`${API_BASE_URL}/online-bookings?hotelName=${encodeURIComponent(getContextHotel())}`);
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
        document.getElementById('onlineBookingTable').innerHTML = '<tr><td colspan="4">Connection failed. Please ensure the backend server is running.</td></tr>';
    }
}

async function acceptBooking(bookingId) {
    showModal(`This will send an OTP to the guest's email for verification. Continue?`, async () => {
        try {
            showLoading("Sending OTP to guest's email...");
            // 1. Send the OTP to the guest first
            const otpResponse = await fetch(`${API_BASE_URL}/online-bookings/send-accept-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bookingId, hotelName: getContextHotel() })
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
                hotelName: getContextHotel(),
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
                    hotelName: getContextHotel()
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
        const [response, guestResponse] = await Promise.all([
            fetchWithRetry(`${API_BASE_URL}/rooms?hotelName=${encodeURIComponent(getContextHotel())}`),
            fetchWithRetry(`${API_BASE_URL}/guests?hotelName=${encodeURIComponent(getContextHotel())}`)
        ]);
        const rooms = await response.json();
        const guests = await guestResponse.json();
        const occupiedRooms = new Set(guests.map(g => g.ROOM_NUMBER));

        const roomTable = document.getElementById('roomTable');
        const canManage = user.role === 'Owner' || user.role === 'Admin' || user.permissions.manageRooms;

        // Hide the static Add Room form and inject an Add button if permitted
        const staticForm = document.getElementById('addRoomForm');
        if (staticForm) staticForm.style.display = 'none';

        if (canManage) {
            setupHeaderAction('roomTable', 'dynamicAddRoomBtn', 'Add New Room', () => openRoomModal());
        }

        if (rooms.length === 0) {
            roomTable.innerHTML = '<tr><td colspan="6">No rooms found. Add a room to get started.</td></tr>';
            return;
        }

        roomTable.innerHTML = rooms.map(room => {
            const isOccupied = occupiedRooms.has(room.ROOM_NUMBER);
            const roomJson = JSON.stringify(room).replace(/'/g, "&#39;");
            const actionButtons = canManage ? `
                <button class="edit-btn" onclick='editRoom(${roomJson})' ${isOccupied ? 'disabled' : ''} title="${isOccupied ? 'Cannot edit occupied room' : 'Edit Room'}"><i class="fa-solid fa-pen-to-square"></i></button>
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
        document.getElementById('roomTable').innerHTML = '<tr><td colspan="6" style="text-align:center; color:red;">Failed to load rooms. <button class="main-btn" style="margin:10px auto;" onclick="renderRooms()">Retry</button></td></tr>';
    }
}

function openRoomModal(room = null) {
    const modal = document.getElementById('actionModal');
    const modalBox = document.getElementById('modalBox');
    
    editingRoomNumber = room ? room.ROOM_NUMBER : null;
    tempRoomPhotos = [];

    // Parse existing photos if editing
    if (room && room.PHOTOS) {
        try {
            const parsed = JSON.parse(room.PHOTOS);
            if (Array.isArray(parsed)) tempRoomPhotos = parsed;
        } catch (e) {
            console.error("Error parsing photos", e);
        }
    }

    modalBox.innerHTML = `
        <h3 style="margin-top:0;">${room ? 'Edit Room' : 'Add New Room'}</h3>
        <select id="modal_roomType" style="width: 100%; padding: 8px; margin: 8px 0; box-sizing: border-box;">
            <option value="AC">AC</option>
            <option value="Non-AC">Non-AC</option>
            <option value="Single Bed">Single Bed</option>
            <option value="Double Bed">Double Bed</option>
            <option value="Luxury">Luxury</option>
            <option value="Super Luxury">Super Luxury</option>
        </select>
        <input type="text" id="modal_roomNumber" placeholder="Room Number" style="width: 100%; padding: 8px; margin: 8px 0; box-sizing: border-box;" ${room ? 'disabled' : ''}>
        <input type="number" id="modal_costHour" placeholder="Cost per Hour" style="width: 100%; padding: 8px; margin: 8px 0; box-sizing: border-box;">
        <input type="number" id="modal_costDay" placeholder="Cost per Day" style="width: 100%; padding: 8px; margin: 8px 0; box-sizing: border-box;">
        <input type="number" id="modal_discount" placeholder="Discount %" style="width: 100%; padding: 8px; margin: 8px 0; box-sizing: border-box;">
        
        <label style="display:block; text-align:left; font-size:12px; margin-top:5px;">Room Photos</label>
        <div id="existingPhotosContainer" class="photo-edit-container"></div>
        
        <input type="file" id="modal_roomPhotos" multiple accept="image/*" style="width: 100%; padding: 8px; margin: 5px 0 8px 0; box-sizing: border-box;">
        
        <div style="margin-top: 15px; display: flex; gap: 10px; justify-content: center;">
            <button class="confirm-btn" onclick="saveRoom()">${room ? 'Update' : 'Save'}</button>
            <button class="cancel-btn" onclick="closeModal()">Cancel</button>
        </div>
    `;

    if (room) {
        document.getElementById('modal_roomType').value = room.ROOM_TYPE;
        document.getElementById('modal_roomNumber').value = room.ROOM_NUMBER;
        document.getElementById('modal_costHour').value = room.COST_PER_HOUR;
        document.getElementById('modal_costDay').value = room.COST_PER_DAY;
        document.getElementById('modal_discount').value = room.DISCOUNT_PERCENT;
        renderExistingPhotos();
    }

    modal.style.display = 'flex';
}

function renderExistingPhotos() {
    const container = document.getElementById('existingPhotosContainer');
    if (!container) return;
    container.innerHTML = tempRoomPhotos.map((src, index) => `
        <div class="photo-wrapper">
            <img src="${src}">
            <button class="photo-delete-btn" onclick="deleteTempPhoto(${index})">×</button>
        </div>
    `).join('');
}

window.deleteTempPhoto = function(index) {
    tempRoomPhotos.splice(index, 1);
    renderExistingPhotos();
}

function editRoom(room) {
    openRoomModal(room);
}

function cancelRoomEdit() {
    closeModal();
}

async function saveRoom() {
  const fileInput = document.getElementById('modal_roomPhotos');
  const type = document.getElementById('modal_roomType').value;
  const number = document.getElementById('modal_roomNumber').value;
  const costHour = document.getElementById('modal_costHour').value;
  const costDay = document.getElementById('modal_costDay').value;
  const discount = document.getElementById('modal_discount').value || 0;

  if (!type || !number || !costHour || !costDay) {
    return showModal('Please fill all required room details.');
  }

  const confirmMessage = editingRoomNumber
    ? `Are you sure you want to update room ${editingRoomNumber}?`
    : 'Are you sure you want to add this room?';

  const action = async () => {
    try {
      showLoading("Processing photos...");
      
      let newPhotos = [];
      if (fileInput.files.length > 0) {
          const promises = Array.from(fileInput.files).map(file => {
              return new Promise((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onload = e => resolve(e.target.result);
                  reader.onerror = reject;
                  reader.readAsDataURL(file);
              });
          });
          newPhotos = await Promise.all(promises);
      }

      // Combine existing kept photos with new uploads
      const finalPhotos = [...tempRoomPhotos, ...newPhotos];

      showLoading("Saving room data...");

      const roomData = {
        type,
        number,
        costHour: +costHour,
        costDay: +costDay,
        discount: +discount,
        hotelName: getContextHotel(),
        photos: finalPhotos.length > 0 ? JSON.stringify(finalPhotos) : null
      };

    let url = `${API_BASE_URL}/rooms`;
    let method = 'POST';

    if (editingRoomNumber) {
      url = `${API_BASE_URL}/rooms/${editingRoomNumber}`;
      method = 'PUT';
    }

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(roomData),
      });
      const result = await response.json();
      if (response.ok) {
        showModal(result.message || 'Room saved successfully!');
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
            const response = await fetch(`${API_BASE_URL}/rooms/${roomNumber}?hotelName=${encodeURIComponent(getContextHotel())}`, { 
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

// --- AVAILABILITY TAB ---
let availabilityChartInstance = null;

async function fetchWithRetry(url, retries = 3, delay = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP error ${response.status}`);
            return response;
        } catch (err) {
            if (i === retries - 1) throw err;
            await new Promise(res => setTimeout(res, delay));
        }
    }
}

async function renderAvailability() {
    const tbody = document.getElementById('availabilityTable');
    
    // Inject Chart Container if missing
    const table = tbody ? tbody.closest('table') : null;
    if (table && !document.getElementById('availabilityChartContainer')) {
        const chartDiv = document.createElement('div');
        chartDiv.id = 'availabilityChartContainer';
        chartDiv.style.height = '300px';
        chartDiv.style.marginBottom = '20px';
        chartDiv.style.position = 'relative';
        chartDiv.innerHTML = '<canvas id="availabilityChart"></canvas>';
        table.parentNode.insertBefore(chartDiv, table);
    }

    try {
        // Show loading if not already shown (e.g. via Refresh button)
        if (document.getElementById('actionModal').style.display === 'none') showLoading("Updating availability...");

        const [roomsResponse, guestsResponse] = await Promise.all([
            fetchWithRetry(`${API_BASE_URL}/rooms?hotelName=${encodeURIComponent(getContextHotel())}`),
            fetchWithRetry(`${API_BASE_URL}/guests?hotelName=${encodeURIComponent(getContextHotel())}`)
        ]);

        const rooms = await roomsResponse.json();
        const guests = await guestsResponse.json();
        
        closeModal();
        
        const occupiedRoomNumbers = new Set(guests.map(g => g.ROOM_NUMBER));
        
        const totalRooms = rooms.length;
        const occupiedCount = occupiedRoomNumbers.size;
        const availableCount = totalRooms - occupiedCount;
        
        document.getElementById('statTotalRooms').textContent = totalRooms;
        document.getElementById('statAvailableRooms').textContent = availableCount;
        document.getElementById('statOccupiedRooms').textContent = occupiedCount;
        
        // Group by type
        const typeStats = {};
        
        rooms.forEach(room => {
            if (!typeStats[room.ROOM_TYPE]) {
                typeStats[room.ROOM_TYPE] = { total: 0, available: 0, occupied: 0, availableNumbers: [] };
            }
            
            typeStats[room.ROOM_TYPE].total++;
            
            if (occupiedRoomNumbers.has(room.ROOM_NUMBER)) {
                typeStats[room.ROOM_TYPE].occupied++;
            } else {
                typeStats[room.ROOM_TYPE].available++;
                typeStats[room.ROOM_TYPE].availableNumbers.push(room.ROOM_NUMBER);
            }
        });
        
        const tbody = document.getElementById('availabilityTable');
        tbody.innerHTML = Object.keys(typeStats).map(type => {
            const stats = typeStats[type];
            return `
                <tr>
                    <td>${type}</td>
                    <td>${stats.total}</td>
                    <td style="color: green; font-weight: bold;">${stats.available}</td>
                    <td style="color: red;">${stats.occupied}</td>
                    <td style="word-break: break-all; max-width: 300px;">${stats.availableNumbers.join(', ') || '-'}</td>
                </tr>
            `;
        }).join('');
        
        // Render Chart
        await loadChartJs();
        const ctx = document.getElementById('availabilityChart');
        if (ctx) {
            if (availabilityChartInstance) availabilityChartInstance.destroy();

            const labels = Object.keys(typeStats);
            const availableData = labels.map(t => typeStats[t].available);
            const occupiedData = labels.map(t => typeStats[t].occupied);
            const isDark = document.body.classList.contains('dark-mode');
            const textColor = isDark ? '#e4e6eb' : '#666';

            availabilityChartInstance = new Chart(ctx.getContext('2d'), {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [
                        { label: 'Available', data: availableData, backgroundColor: '#28a745' },
                        { label: 'Occupied', data: occupiedData, backgroundColor: '#dc3545' }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: { stacked: true, ticks: { color: textColor } },
                        y: { stacked: true, ticks: { color: textColor } }
                    },
                    plugins: {
                        legend: { labels: { color: textColor } }
                    }
                }
            });
        }
        
    } catch (error) {
        console.error('Error rendering availability:', error);
        closeModal();
        if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:red;">Failed to load availability data. <button class="main-btn" style="margin:10px auto;" onclick="renderAvailability()">Retry</button></td></tr>';
    }
}

// --- GUEST & BOOKING MANAGEMENT ---
async function renderGuestsAndBookings() {
    try {
        const response = await fetchWithRetry(`${API_BASE_URL}/guests?hotelName=${encodeURIComponent(getContextHotel())}`);
        const guests = await response.json();
        const guestTable = document.getElementById('guestTable');
        const bookingTable = document.getElementById('bookingTable');
        const canEditGuests = user.role === 'Owner' || user.role === 'Admin' || user.permissions.editGuests;
        const canAddGuests = user.role === 'Owner' || user.role === 'Admin' || user.permissions.addGuests;

        // Hide the static Add Guest form and inject an Add button if permitted
        const staticGuestForm = document.getElementById('addGuestForm');
        if (staticGuestForm) staticGuestForm.style.display = 'none';

        if (canAddGuests) {
            setupHeaderAction('guestTable', 'dynamicAddGuestBtn', 'Add New Guest', () => openGuestModal());
        }

        // Fix: Ensure Email header exists in the table to prevent alignment issues
        const table = guestTable.closest('table');
        if (table) {
            const headerRow = table.querySelector('thead tr');
            if (headerRow) {
                const headers = Array.from(headerRow.children);
                const hasEmail = headers.some(th => th.textContent.trim() === 'Email');
                if (!hasEmail) {
                    const mobileIndex = headers.findIndex(th => th.textContent.includes('Mobile'));
                    if (mobileIndex !== -1) {
                        const emailTh = document.createElement('th');
                        emailTh.textContent = 'Email';
                        headerRow.insertBefore(emailTh, headerRow.children[mobileIndex + 1] || null);
                    }
                }
            }
        }
 
        guestTable.innerHTML = guests.map(g => {
            const guestJson = JSON.stringify(g).replace(/'/g, "&#39;");
            const actionCell = canEditGuests ? `
              <td class="actions-cell">
                <button class="edit-btn" onclick='editGuest(${guestJson})'><i class="fa-solid fa-pen-to-square"></i> Edit</button>
              </td>` : '<td>No Access</td>';
            const fullMobile = `${g.COUNTRY_CODE || ''} ${g.MOBILE_NUMBER || 'N/A'}`;
            return `
              <tr>
                <td>${g.GUEST_NAME}</td>
                <td>${g.AGE || 'N/A'}</td>
                <td>${g.GENDER || 'N/A'}</td>
                <td>${fullMobile}</td>
                <td>${g.EMAIL || 'N/A'}</td>
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
        const table = document.getElementById('guestTable');
        if (table) table.innerHTML = '<tr><td colspan="10" style="text-align:center; color:red;">Failed to load guests. <button class="main-btn" style="margin:10px auto;" onclick="renderGuestsAndBookings()">Retry</button></td></tr>';
    }
}

function openGuestModal(guest = null) {
    const modal = document.getElementById('actionModal');
    const modalBox = document.getElementById('modalBox');
    
    editingGuestId = guest ? guest.GUEST_ID : null;
    
    const now = new Date();
    const defaultCheckIn = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);

    modalBox.innerHTML = `
        <h3 style="margin-top:0;">${guest ? 'Edit Guest' : 'Add New Guest'}</h3>
        <input type="text" id="modal_guestName" placeholder="Guest Name" style="width: 100%; padding: 8px; margin: 8px 0; box-sizing: border-box;">
        <div style="display:flex; gap:10px;">
            <input type="number" id="modal_guestAge" placeholder="Age" style="flex:1; padding: 8px; margin: 8px 0; box-sizing: border-box;">
            <select id="modal_guestGender" style="flex:1; padding: 8px; margin: 8px 0; box-sizing: border-box;">
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
            </select>
        </div>
        <div style="display:flex; gap:10px;">
             <select id="modal_guestCountryCode" style="width: 30%; padding: 8px; margin: 8px 0; box-sizing: border-box;">
                <option value="+91">+91</option>
                <option value="+1">+1</option>
                <option value="+44">+44</option>
             </select>
             <input type="text" id="modal_guestMobile" placeholder="Mobile" style="flex:1; padding: 8px; margin: 8px 0; box-sizing: border-box;">
        </div>
        <input type="email" id="modal_guestEmail" placeholder="Email" style="width: 100%; padding: 8px; margin: 8px 0; box-sizing: border-box;">
        <input type="text" id="modal_guestRoom" placeholder="Room Number" style="width: 100%; padding: 8px; margin: 8px 0; box-sizing: border-box;">
        
        <div style="display:flex; gap:10px;">
            <select id="modal_guestVerificationType" style="flex:1; padding: 8px; margin: 8px 0; box-sizing: border-box;">
                <option value="Aadhaar Card">Aadhaar Card</option>
                <option value="PAN Card">PAN Card</option>
                <option value="Passport">Passport</option>
                <option value="Driving License">Driving License</option>
                <option value="Other">Other</option>
            </select>
            <input type="text" id="modal_guestVerificationId" placeholder="ID Number" style="flex:1; padding: 8px; margin: 8px 0; box-sizing: border-box;">
        </div>
        
        <label style="display:block; text-align:left; font-size:12px; margin-top:5px;">Check-in Time</label>
        <input type="datetime-local" id="modal_guestCheckIn" value="${defaultCheckIn}" style="width: 100%; padding: 8px; margin: 5px 0 8px 0; box-sizing: border-box;">

        <div style="margin-top: 15px; display: flex; gap: 10px; justify-content: center;">
            <button class="confirm-btn" onclick="saveGuest()">${guest ? 'Update' : 'Check-In'}</button>
            <button class="cancel-btn" onclick="closeModal()">Cancel</button>
        </div>
    `;

    if (guest) {
        document.getElementById('modal_guestName').value = guest.GUEST_NAME;
        document.getElementById('modal_guestAge').value = guest.AGE;
        document.getElementById('modal_guestGender').value = guest.GENDER;
        document.getElementById('modal_guestCountryCode').value = guest.COUNTRY_CODE || '+91';
        document.getElementById('modal_guestMobile').value = guest.MOBILE_NUMBER;
        document.getElementById('modal_guestEmail').value = guest.EMAIL || '';
        document.getElementById('modal_guestRoom').value = guest.ROOM_NUMBER;
        document.getElementById('modal_guestVerificationType').value = guest.VERIFICATION_ID_TYPE || '';
        document.getElementById('modal_guestVerificationId').value = guest.VERIFICATION_ID || '';
        const checkInDate = new Date(guest.CHECK_IN_TIME);
        const localCheckIn = new Date(checkInDate.getTime() - (checkInDate.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
        document.getElementById('modal_guestCheckIn').value = localCheckIn;
    }

    modal.style.display = 'flex';
}

function editGuest(guest) {
    openGuestModal(guest);
}

function cancelGuestEdit() {
    closeModal();
}

async function saveGuest() {
    const guestData = {
        name: document.getElementById('modal_guestName').value.trim(),
        age: document.getElementById('modal_guestAge').value,
        gender: document.getElementById('modal_guestGender').value,
        countryCode: document.getElementById('modal_guestCountryCode').value,
        mobile: document.getElementById('modal_guestMobile').value.trim(),
        email: document.getElementById('modal_guestEmail') ? document.getElementById('modal_guestEmail').value.trim() : '',
        room: document.getElementById('modal_guestRoom').value.trim(),
        verificationIdType: document.getElementById('modal_guestVerificationType').value,
        verificationId: document.getElementById('modal_guestVerificationId').value.trim(),
        checkIn: document.getElementById('modal_guestCheckIn').value,
        address: user.address || '', 
        hotelName: getContextHotel()
    };

    if (!guestData.name || !guestData.room || !guestData.checkIn || !guestData.mobile || !guestData.email) {
        return showModal('Please enter all guest details including email and check-in time!');
    }

    if (editingGuestId) {
        // If editing, just confirm and save without OTP
        showModal(`Are you sure you want to update this guest?`, () => updateGuestDetails(guestData));
    } else {
        // If adding a new guest, start OTP flow
        if (!guestData.email || !/\S+@\S+\.\S+/.test(guestData.email)) {
            return showModal('Please enter a valid email address for the guest.');
        }
        showModal(`This will send an OTP to the guest's email (${guestData.email}) for verification. Continue?`, async () => {
            try {
                showLoading("Sending OTP...");
                const otpResponse = await fetch(`${API_BASE_URL}/guest/send-checkin-otp`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: guestData.email })
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
        <p>An OTP was sent to ${guestData.email}. Please enter it below to complete the check-in.</p>
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
        showLoading("Updating guest details...");
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
        const guestsResponse = await fetch(`${API_BASE_URL}/guests?hotelName=${encodeURIComponent(getContextHotel())}`);
        const guests = await guestsResponse.json();
        const guestToCheckOut = guests.find(g => g.ROOM_NUMBER === roomNo);
        if (!guestToCheckOut) {
            return showModal(`No active guest found in room ${roomNo}.`);
        }
        
        const roomResponse = await fetch(`${API_BASE_URL}/rooms?hotelName=${encodeURIComponent(getContextHotel())}`);
        const rooms = await roomResponse.json();
        const room = rooms.find(r => r.ROOM_NUMBER === roomNo);
        if (!room) {
             return showModal(`Room details for ${roomNo} not found.`);
        }

        // Fetch Food Orders
        let foodTotal = 0;
        let foodItemsHtml = '';
        try {
            const foodRes = await fetch(`${API_BASE_URL}/food-orders?roomNumber=${roomNo}&status=Delivered`);
            const foodOrders = await foodRes.json();
            // Filter for orders belonging to this guest session if needed, for now assume room based
            foodTotal = foodOrders.reduce((sum, o) => sum + (o.totalCost || 0), 0);
            if (foodOrders.length > 0) foodItemsHtml = `<p><strong>Food Charges:</strong> ₹${foodTotal.toFixed(2)}</p>`;
        } catch (e) { console.log("No food orders or backend not ready"); }

        const checkIn = new Date(guestToCheckOut.CHECK_IN_TIME);
        const checkOut = new Date();
        const hours = Math.ceil((checkOut - checkIn) / 3600000);
        const days = Math.floor(hours / 24);
        const remHours = hours % 24;
        const grossAmount = (days * room.COST_PER_DAY) + (remHours * room.COST_PER_HOUR);
        const discountAmount = (grossAmount * room.DISCOUNT_PERCENT) / 100;
        const finalAmount = (grossAmount - discountAmount) + foodTotal;

        currentBillData = {
            guestId: guestToCheckOut.GUEST_ID,
            guestName: guestToCheckOut.GUEST_NAME,
            roomNumber: roomNo,
            checkInTime: checkIn.toLocaleString(),
            checkOutTime: checkOut.toLocaleString(),
            totalHours: hours,
            grossAmount: grossAmount,
            hotelName: getContextHotel(),
            foodAmount: foodTotal,
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
                ${foodItemsHtml}
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
                <div class="bill-row"><strong>Food Charges:</strong> ₹${(currentBillData.foodAmount || 0).toFixed(2)}</div>
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
    if (user.role === 'Employee') return;
    const container = document.getElementById('historyContainer');
    try {
        const response = await fetch(`${API_BASE_URL}/history?hotelName=${encodeURIComponent(getContextHotel())}`);
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

function getServiceArea(role) {
    if (role === 'Chef') return 'Kitchen';
    if (role === 'Waiter') return 'Delivery';
    if (role === 'Housekeeping') return 'Requests';
    if (role === 'Room') return 'Ordering';
    return '-';
}

// --- ACCESS MANAGEMENT (OWNER ONLY) ---
async function renderAccessTable() {
    if (user.role !== 'Owner' && user.role !== 'Admin') return;

    try {
        const response = await fetch(`${API_BASE_URL}/users?hotelName=${encodeURIComponent(getContextHotel())}`);
        const users = await response.json();
        const table = document.getElementById('accessTable');

        // Ensure the "Service Area" header exists in the table (inject if missing)
        const tableElem = table.closest('table');
        if (tableElem) {
            const theadRow = tableElem.querySelector('thead tr');
            if (theadRow && !Array.from(theadRow.children).some(th => th.textContent === 'Service Area')) {
                const th = document.createElement('th');
                th.textContent = 'Service Area';
                // Insert after Address (index 2) -> index 3
                if (theadRow.children.length > 3) theadRow.insertBefore(th, theadRow.children[3]);
            }
        }

        // Add "Add Employee" button to the top right
        setupHeaderAction('accessTable', 'addUserBtn', 'Add New Employee', () => openCreateAccountModal());
        
        if (users.length === 0) {
            table.innerHTML = '<tr><td colspan="5">No employees found to manage.</td></tr>';
            return;
        }
        table.innerHTML = users.map(u => {
            const userJson = JSON.stringify(u).replace(/'/g, "&#39;");
            const isSpecialRole = u.ROLE === 'Chef' || u.ROLE === 'Waiter';
            
            // Helper to render toggle or N/A
            const renderToggle = (perm, col) => isSpecialRole 
                ? `<td style="color:#ccc; text-align:center;">-</td>` 
                : `<td><label class="switch" title="Allow user to ${col}"><input type="checkbox" ${perm === 1 ? 'checked' : ''} onchange="updateUserPermission(${u.USER_ID}, '${col}', this)"><span class="slider round"></span></label></td>`;

            return `
            <tr>
                <td>${u.FULL_NAME} (${u.ROLE})</td>
                <td>${u.EMAIL || 'N/A'}</td>
                <td>${u.ADDRESS || 'N/A'}</td>
                <td style="text-align:center; font-weight:500;">${getServiceArea(u.ROLE)}</td>
                ${renderToggle(u.PERM_MANAGE_ROOMS, 'manageRooms')}
                ${renderToggle(u.PERM_ADD_GUESTS, 'addGuests')}
                ${renderToggle(u.PERM_EDIT_GUESTS, 'editGuests')}
                <td>
                    <button class="edit-btn" onclick='editUser(${userJson})' style="margin: 0 auto 5px auto;" title="Edit Employee">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button class="delete-btn" onclick="deleteUser(${u.USER_ID}, '${u.FULL_NAME.replace(/'/g, "\\'")}')" style="margin: 0 auto;" title="Delete Employee">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </td>
            </tr>
        `}).join('');
    } catch (error) {
        console.error('Failed to load access data:', error);
        document.getElementById('accessTable').innerHTML = '<tr><td colspan="5">Error loading users.</td></tr>';
    }
}

function filterAccessTable() {
    const input = document.getElementById('accessSearch');
    const filter = input.value.toLowerCase();
    const table = document.getElementById('accessTable');
    const tr = table.getElementsByTagName('tr');

    for (let i = 0; i < tr.length; i++) {
        const tdName = tr[i].getElementsByTagName('td')[0];
        const tdEmail = tr[i].getElementsByTagName('td')[1];
        if (tdName || tdEmail) {
            const txtValueName = tdName.textContent || tdName.innerText;
            const txtValueEmail = tdEmail.textContent || tdEmail.innerText;
            tr[i].style.display = (txtValueName.toLowerCase().indexOf(filter) > -1 || txtValueEmail.toLowerCase().indexOf(filter) > -1) ? "" : "none";
        }
    }
}

async function updateUserPermission(userId, permission, checkbox) {
    const value = checkbox.checked;
    
    const proceed = async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/users/${userId}/permissions`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ [permission]: value })
            });
            const result = await response.json();
            if (!response.ok) {
                showModal(result.message || 'Failed to update permission.');
                checkbox.checked = !value; // Revert UI on failure
            }
        } catch (error) {
            console.error('Error updating permission:', error);
            showModal('An error occurred while updating permission.');
            checkbox.checked = !value; // Revert UI on error
        }
    };

    if (permission === 'manageRooms') {
        const action = value ? 'grant' : 'revoke';
        showModal(
            `Are you sure you want to ${action} "Manage Rooms" permission? This allows deleting rooms.`,
            proceed,
            () => { checkbox.checked = !value; } // Revert on cancel
        );
    } else {
        proceed();
    }
}

function editUser(u) {
    const modal = document.getElementById('actionModal');
    const modalBox = document.getElementById('modalBox');
    modalBox.innerHTML = `
        <h3 style="margin-top:0;">Edit Employee</h3>
        <input type="text" id="editFullName" placeholder="Full Name" value="${u.FULL_NAME}" style="width: 100%; padding: 8px; margin: 8px 0; box-sizing: border-box;">
        <input type="email" id="editEmail" placeholder="Email" value="${u.EMAIL || ''}" style="width: 100%; padding: 8px; margin: 8px 0; box-sizing: border-box;">
        <input type="text" id="editMobile" placeholder="Mobile Number" value="${u.MOBILE_NUMBER || ''}" style="width: 100%; padding: 8px; margin: 8px 0; box-sizing: border-box;">
        <input type="text" id="editAddress" placeholder="Address" value="${u.ADDRESS || ''}" style="width: 100%; padding: 8px; margin: 8px 0; box-sizing: border-box;">
        <select id="editRole" style="width: 100%; padding: 8px; margin: 8px 0; box-sizing: border-box;">
            <option value="Employee" ${u.ROLE === 'Employee' ? 'selected' : ''}>Employee</option>
            <option value="Manager" ${u.ROLE === 'Manager' ? 'selected' : ''}>Manager</option>
            <option value="Chef" ${u.ROLE === 'Chef' ? 'selected' : ''}>Chef</option>
            <option value="Waiter" ${u.ROLE === 'Waiter' ? 'selected' : ''}>Waiter</option>
            <option value="Housekeeping" ${u.ROLE === 'Housekeeping' ? 'selected' : ''}>Housekeeping</option>
        </select>
        <div style="margin-top: 15px; display: flex; gap: 10px; justify-content: center;">
            <button class="confirm-btn" onclick="saveUserEdit(${u.USER_ID})">Save Changes</button>
            <button class="cancel-btn" onclick="closeModal()">Cancel</button>
        </div>
    `;
    modal.style.display = 'flex';
}

async function saveUserEdit(userId) {
    const updatedData = {
        fullName: document.getElementById('editFullName').value.trim(),
        email: document.getElementById('editEmail').value.trim(),
        mobile: document.getElementById('editMobile').value.trim(),
        address: document.getElementById('editAddress').value.trim(),
        role: document.getElementById('editRole').value
    };

    try {
        showLoading("Updating employee details...");
        const response = await fetch(`${API_BASE_URL}/users/${userId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedData)
        });
        const result = await response.json();
        showModal(result.message);
        if (response.ok) {
            renderAccessTable();
        }
    } catch (error) {
        console.error('Error updating user:', error);
        showModal('Failed to update user details.');
    }
}

async function deleteUser(userId, userName) {
    showModal(`Are you sure you want to delete employee ${userName}?`, async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/users/${userId}`, {
                method: 'DELETE'
            });
            const result = await response.json();
            showModal(result.message);
            if (response.ok) renderAccessTable();
        } catch (error) {
            console.error('Error deleting user:', error);
            showModal('An error occurred while deleting the user.');
        }
    });
}

function openCreateAccountModal() {
    const modal = document.getElementById('actionModal');
    const modalBox = document.getElementById('modalBox');
    modalBox.innerHTML = `
        <h3 style="margin-top:0;">Create New Employee Account</h3>
        <input type="text" id="newFullName" placeholder="Full Name" style="width: 100%; padding: 8px; margin: 8px 0; box-sizing: border-box;">
        <input type="email" id="newEmail" placeholder="Email" style="width: 100%; padding: 8px; margin: 8px 0; box-sizing: border-box;">
        <input type="text" id="newMobile" placeholder="Mobile Number" style="width: 100%; padding: 8px; margin: 8px 0; box-sizing: border-box;">
        <input type="text" id="newAddress" placeholder="Address" style="width: 100%; padding: 8px; margin: 8px 0; box-sizing: border-box;">
        <select id="newRole" style="width: 100%; padding: 8px; margin: 8px 0; box-sizing: border-box;">
            <option value="Employee">Employee</option>
            <option value="Manager">Manager</option>
            <option value="Chef">Chef</option>
            <option value="Waiter">Waiter</option>
            <option value="Housekeeping">Housekeeping</option>
            <option value="Room">Room Screen</option>
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
        email: document.getElementById('newEmail').value.trim(),
        mobile: document.getElementById('newMobile').value.trim(),
        address: document.getElementById('newAddress').value.trim(),
        role: document.getElementById('newRole').value,
        hotelName: getContextHotel()
    };

    if (accountData.role === 'Room') {
        if (!accountData.fullName) {
            return showModal('Room Name (e.g., Room 101) is required.');
        }
    } else {
        if (!accountData.fullName || !accountData.email || !accountData.mobile) {
            return showModal('Full Name, Email, and Mobile Number are required.');
        }
    }

    try {
        showLoading("Creating account and sending credentials...");
        const response = await fetch(`${API_BASE_URL}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(accountData)
        });
        const result = await response.json();
        if (response.ok) {
            closeModal();
            showModal('Account created! Login details and reset link sent to email.');
            renderAccessTable();
        } else {
            showModal(result.message || 'Failed to create account.');
        }
    } catch (error) {
        console.error('Error creating account:', error);
        showModal('An error occurred while creating the account.');
    }
}

async function showUserDetails() {
    let reportsToName = 'Loading...';
    
    try {
        if (user.role === 'Owner') {
            reportsToName = 'Self (Owner)';
        } else {
            const response = await fetch(`${API_BASE_URL}/hotel/owner?hotelName=${encodeURIComponent(getContextHotel())}`);
            const data = await response.json();
            reportsToName = data.ownerName;
        }
    } catch (e) {
        reportsToName = 'Owner';
    }

    const modal = document.getElementById('actionModal');
    const modalBox = document.getElementById('modalBox');
    const profilePicSrc = user.profilePicture || 'https://via.placeholder.com/100';
    
    modalBox.innerHTML = `
        <h3 style="margin-top:0; border-bottom: 1px solid #eee; padding-bottom: 10px;">Profile Settings</h3>
        <div style="text-align: center; margin-bottom: 15px;">
            <img id="previewProfilePic" src="${profilePicSrc}" style="width: 100px; height: 100px; border-radius: 50%; object-fit: cover; border: 3px solid #007bff;">
            <br>
            <label for="profilePicInput" style="cursor: pointer; color: #007bff; font-size: 13px; text-decoration: underline; margin-top: 5px; display: inline-block;">
                <i class="fa-solid fa-camera"></i> Change Picture
            </label>
            <input type="file" id="profilePicInput" accept="image/*" style="display: none;" onchange="handleProfilePicSelect(this)">
        </div>
        
        <div style="text-align: left; padding: 0 20px; margin-bottom: 15px;">
            <div style="padding: 15px; border-radius: 8px; border: 1px solid #ccc; font-size: 14px;">
                <div style="display: grid; grid-template-columns: 100px 1fr; gap: 8px;">
                    <strong>Name:</strong> <span>${user.fullName}</span>
                    <strong>Role:</strong> <span>${user.role}</span>
                    <strong>Username:</strong> <span>${user.username}</span>
                    <strong>Email:</strong> <span>${user.email || 'N/A'}</span>
                    <strong>Mobile:</strong> <span>${user.mobile || 'N/A'}</span>
                    <strong>Address:</strong> <span>${user.address || 'N/A'}</span>
                    <strong>Hotel:</strong> <span>${user.hotelName}</span>
                </div>
                <div style="margin-top: 10px; padding-top: 10px; border-top: 1px dashed #ccc; color: #007bff; font-weight: 500;">
                    Reports To: ${reportsToName}
                </div>
            </div>
            <p style="font-size: 11px; opacity: 0.7; margin-top: 8px; text-align: center; font-style: italic;">
                * Personal details are read-only. Contact the Owner for updates.
            </p>
        </div>
        <div style="margin-top: 15px; text-align: center; display: flex; flex-direction: column; gap: 10px; align-items: center;">
            <button class="confirm-btn" onclick="saveProfilePicture()" id="savePicBtn" style="display:none; width: 200px;">Save New Picture</button>
            <button class="main-btn" onclick="openChangePasswordModal()" style="width: 200px; background-color: #6c757d;"><i class="fa-solid fa-key"></i> Change Password</button>
            <button class="cancel-btn" onclick="closeModal()" style="width: 200px;">Close</button>
        </div>
    `;
    modal.style.display = 'flex';
}

function handleProfilePicSelect(input) {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = function(e) {
            document.getElementById('previewProfilePic').src = e.target.result;
            document.getElementById('savePicBtn').style.display = 'inline-block';
        };
        reader.readAsDataURL(input.files[0]);
    }
}

async function saveProfilePicture() {
    const imgData = document.getElementById('previewProfilePic').src;
    try {
        showLoading("Uploading picture...");
        const response = await fetch(`${API_BASE_URL}/users/${user.userId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profilePicture: imgData })
        });
        const result = await response.json();
        if (response.ok) {
            await refreshUserProfile(); // Reload user data to update sidebar
            showModal('Profile picture updated!');
        } else {
            showModal(result.message || 'Failed to update picture.');
        }
    } catch (error) {
        console.error(error);
        showModal('Error uploading picture.');
    }
}

async function refreshUserProfile() {
    if (!user || !user.username) return;
    try {
        const response = await fetch(`${API_BASE_URL}/users/${user.username}`);
        if (response.ok) {
            const updatedUser = await response.json();
            localStorage.setItem('hmsCurrentUser', JSON.stringify(updatedUser));
            user = updatedUser; 
            await applyUIPermissions();
        }
    } catch (e) {
        console.error("Failed to refresh user profile", e);
    }
}

async function markAllOrdersPrepared() {
    showModal("Are you sure you want to mark all pending orders as prepared?", async () => {
        try {
            showLoading("Updating orders...");
            const response = await fetch(`${API_BASE_URL}/food-orders?status=Pending`);
            const orders = await response.json();
            
            await Promise.all(orders.map(o => 
                fetch(`${API_BASE_URL}/food-orders/${o.id}`, {
                    method: 'PUT',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ status: 'Prepared' })
                })
            ));
            
            closeModal();
            renderKitchenOrders();
        } catch (e) {
            console.error("Failed to mark all prepared", e);
            showModal("Failed to update orders.");
        }
    });
}

// --- KITCHEN & DELIVERY VIEWS ---
async function renderKitchenOrders() {
    const container = document.getElementById('kitchenOrdersList');
    try {
        const response = await fetch(`${API_BASE_URL}/food-orders?status=Pending`);
        const orders = await response.json();
        
        const currentIds = new Set(orders.map(o => o.id));
        if (kitchenInitialized) {
            const hasNew = orders.some(o => !previousKitchenOrderIds.has(o.id));
            if (hasNew) {
                notificationSound.play().catch(e => console.warn("Sound blocked:", e));
            }
        } else {
            kitchenInitialized = true;
        }
        previousKitchenOrderIds = currentIds;

        if (orders.length === 0) {
            container.innerHTML = `
                <div style="text-align: right; margin-bottom: 10px;">
                    <button class="confirm-btn" onclick="openChefStockModal()" style="background-color: #ffc107; color: #000;">
                        <i class="fa-solid fa-box-open"></i> Manage Stock
                    </button>
                </div>
                <p>No pending orders.</p>`;
            return;
        }

        container.innerHTML = `
            <div style="text-align: right; margin-bottom: 10px;">
                <button class="confirm-btn" onclick="openChefStockModal()" style="background-color: #ffc107; color: #000; margin-right: 10px;">
                    <i class="fa-solid fa-box-open"></i> Manage Stock
                </button>
                <button class="confirm-btn" onclick="markAllOrdersPrepared()" style="background-color: #28a745;">
                    <i class="fa-solid fa-check-double"></i> Mark All Prepared
                </button>
            </div>` + orders.map(o => `
            <div class="bill-card" style="text-align:left; margin-bottom:15px;">
                <div style="display:flex; justify-content:space-between;">
                    <h3>Order #${o.id}</h3>
                    <span>${new Date(o.timestamp).toLocaleTimeString()}</span>
                </div>
                <ul style="margin:10px 0; padding-left:20px;">
                    ${o.items.map(i => `<li>${i.name}</li>`).join('')}
                </ul>
                <button class="confirm-btn" onclick="updateOrderStatus(${o.id}, 'Prepared')">Mark Prepared</button>
            </div>
        `).join('');
    } catch (e) {
        container.innerHTML = '<p>Waiting for orders...</p>';
    }
}

async function openChefStockModal() {
    const modal = document.getElementById('actionModal');
    const modalBox = document.getElementById('modalBox');
    
    showLoading("Loading menu items...");
    
    try {
        const response = await fetch(`${API_BASE_URL}/menu`);
        const menuItems = await response.json();
        
        const categories = {};
        menuItems.forEach(item => {
            const cat = item.CATEGORY || 'Main Course';
            if (!categories[cat]) categories[cat] = [];
            categories[cat].push(item);
        });

        let contentHtml = '<div style="max-height: 400px; overflow-y: auto; text-align: left; padding-right: 5px;">';
        
        for (const cat in categories) {
            contentHtml += `<h4 style="margin: 15px 0 5px; border-bottom: 1px solid #eee; color: #555;">${cat}</h4>`;
            categories[cat].forEach(item => {
                const isAvailable = item.IS_AVAILABLE === 1;
                contentHtml += `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px dashed #eee;">
                        <span style="font-weight: 500;">${item.NAME}</span>
                        <label class="switch" title="Toggle Stock Status">
                            <input type="checkbox" ${isAvailable ? 'checked' : ''} onchange="toggleChefStock(${item.ID}, this)">
                            <span class="slider round"></span>
                        </label>
                    </div>
                `;
            });
        }
        contentHtml += '</div>';

        modalBox.innerHTML = `
            <h3 style="margin-top:0;">Manage Kitchen Stock</h3>
            <p style="font-size: 13px; color: #666; margin-bottom: 15px;">Toggle items to mark them as In Stock or Out of Stock.</p>
            ${contentHtml}
            <div style="margin-top: 15px; text-align: center;">
                <button class="confirm-btn" onclick="closeModal()">Done</button>
            </div>
        `;
        modal.style.display = 'flex';
        
    } catch (e) {
        console.error(e);
        showModal("Failed to load menu items.");
    }
}

async function toggleChefStock(id, checkbox) {
    const isAvailable = checkbox.checked;
    try {
        await fetch(`${API_BASE_URL}/menu/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isAvailable })
        });
    } catch (e) {
        console.error(e);
        checkbox.checked = !isAvailable;
        alert("Failed to update availability");
    }
}

async function renderDeliveryOrders() {
    const container = document.getElementById('deliveryOrdersList');
    try {
        const response = await fetch(`${API_BASE_URL}/food-orders?status=Prepared`);
        const orders = await response.json();
        
        if (orders.length === 0) {
            container.innerHTML = '<p>No orders ready for delivery.</p>';
            return;
        }

        container.innerHTML = orders.map(o => `
            <div class="bill-card" style="text-align:left; margin-bottom:15px; border-left: 5px solid #28a745;">
                <div style="display:flex; justify-content:space-between;">
                    <h3>Room: ${o.roomNumber}</h3>
                    <span>Order #${o.id}</span>
                </div>
                <p><strong>Items to Deliver:</strong></p>
                <ul style="margin:10px 0; padding-left:20px;">
                    ${o.items.map(i => `<li>${i.name}</li>`).join('')}
                </ul>
                <button class="confirm-btn" onclick="updateOrderStatus(${o.id}, 'Delivered')">Mark Delivered</button>
            </div>
        `).join('');
    } catch (e) {
        container.innerHTML = '<p>Waiting for prepared food...</p>';
    }
}

// --- MENU MANAGEMENT (OWNER ONLY) ---
async function renderMenuManagement() {
    const container = document.getElementById('menuManagementList');
    if (!container) return;

    setupHeaderAction('menuManagementList', 'addMenuItemBtn', 'Add Item', () => openMenuModal());
    setupHeaderAction('menuManagementList', 'bulkAddMenuItemBtn', 'Bulk Add', () => openBulkAddMenuModal());
    setupHeaderAction('menuManagementList', 'bulkDeleteMenuItemBtn', 'Delete Selected', () => deleteSelectedMenuItems());

    try {
        const response = await fetch(`${API_BASE_URL}/menu`);
        allMenuItems = await response.json();
        updateMenuTable();
    } catch (e) {
        console.error("Failed to load menu", e);
        container.innerHTML = '<p>Error loading menu.</p>';
    }
}

function updateMenuTable() {
    const container = document.getElementById('menuManagementList');
    const paginationContainer = document.getElementById('menuPaginationControls');
    
    if (!container) return;

    // Filter items based on search term
    const filteredItems = allMenuItems.filter(item => 
        item.NAME.toLowerCase().includes(menuSearchTerm.toLowerCase()) ||
        (item.CATEGORY && item.CATEGORY.toLowerCase().includes(menuSearchTerm.toLowerCase()))
    );

    // Pagination Logic
    const totalPages = Math.ceil(filteredItems.length / menuItemsPerPage);
    if (currentMenuPage > totalPages) currentMenuPage = 1;
    if (currentMenuPage < 1) currentMenuPage = 1;
    
    const startIndex = (currentMenuPage - 1) * menuItemsPerPage;
    const paginatedItems = filteredItems.slice(startIndex, startIndex + menuItemsPerPage);

    if (filteredItems.length === 0) {
        container.innerHTML = '<p>No menu items found matching your search.</p>';
        if (paginationContainer) paginationContainer.innerHTML = '';
        return;
    }

    container.innerHTML = `
        <table class="styled-table">
            <thead>
                <tr><th style="width: 60px; text-align: center;"><input type="checkbox" onchange="toggleSelectAllMenu(this)" style="transform: scale(0.8); cursor: pointer;"></th><th>Image</th><th>Name</th><th>Category</th><th>Availability</th><th>Price</th><th>Action</th></tr>
            </thead>
            <tbody>
                ${paginatedItems.map(i => {
                    const itemJson = JSON.stringify(i).replace(/'/g, "&#39;");
                    const isAvailable = i.IS_AVAILABLE === 1;
                    return `
                    <tr>
                        <td style="text-align: center;"><input type="checkbox" class="menu-checkbox" value="${i.ID}" ${selectedMenuIds.has(i.ID) ? 'checked' : ''} onchange="toggleSelectMenu(${i.ID})" style="transform: scale(0.8); cursor: pointer;"></td>
                        <td><img src="${i.IMAGE_URL || 'https://via.placeholder.com/50'}" style="width:50px;height:50px;object-fit:cover;border-radius:4px;"></td>
                        <td>${i.NAME}</td>
                        <td>${i.CATEGORY || 'Main Course'}</td>
                        <td><label class="switch" title="Toggle Stock Status"><input type="checkbox" ${isAvailable ? 'checked' : ''} onchange="toggleMenuAvailability(${i.ID}, this)"><span class="slider round"></span></label></td>
                        <td>₹${i.PRICE}</td>
                        <td>
                            <button class="edit-btn" onclick='openMenuModal(${itemJson})' style="margin-right:5px;"><i class="fa-solid fa-pen-to-square"></i></button>
                            <button class="delete-btn" onclick="deleteMenuItem(${i.ID})"><i class="fa-solid fa-trash"></i></button>
                        </td>
                    </tr>
                `}).join('')}
            </tbody>
        </table>
    `;

    // Update Delete Selected Button State
    const bulkDelBtn = document.getElementById('bulkDeleteMenuItemBtn');
    if (bulkDelBtn) {
        bulkDelBtn.style.display = selectedMenuIds.size > 0 ? 'inline-block' : 'none';
        bulkDelBtn.style.backgroundColor = '#dc3545'; // Red color
    }

    // Render Pagination Controls
    if (paginationContainer) {
        if (totalPages <= 1) {
            paginationContainer.innerHTML = '';
        } else {
            let paginationHTML = '';
            // Prev Button
            paginationHTML += `<button class="page-btn" ${currentMenuPage === 1 ? 'disabled' : ''} onclick="changeMenuPage(${currentMenuPage - 1})">&laquo;</button>`;
            
            // Page Numbers
            for (let i = 1; i <= totalPages; i++) {
                paginationHTML += `<button class="page-btn ${i === currentMenuPage ? 'active' : ''}" onclick="changeMenuPage(${i})">${i}</button>`;
            }
            
            // Next Button
            paginationHTML += `<button class="page-btn" ${currentMenuPage === totalPages ? 'disabled' : ''} onclick="changeMenuPage(${currentMenuPage + 1})">&raquo;</button>`;
            
            paginationContainer.innerHTML = paginationHTML;
        }
    }
}

async function toggleMenuAvailability(id, checkbox) {
    const isAvailable = checkbox.checked;
    try {
        await fetch(`${API_BASE_URL}/menu/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isAvailable })
        });
        // Update local state to reflect change without full reload
        const item = allMenuItems.find(i => i.ID === id);
        if (item) item.IS_AVAILABLE = isAvailable ? 1 : 0;
    } catch (e) {
        console.error(e);
        checkbox.checked = !isAvailable; // Revert UI on failure
        alert("Failed to update availability");
    }
}

function handleMenuSearch(value) {
    menuSearchTerm = value;
    currentMenuPage = 1; // Reset to first page on new search
    updateMenuTable();
}

function changeMenuPage(page) {
    currentMenuPage = page;
    updateMenuTable();
}

function toggleSelectAllMenu(checkbox) {
    const checkboxes = document.querySelectorAll('.menu-checkbox');
    checkboxes.forEach(cb => {
        cb.checked = checkbox.checked;
        const id = parseInt(cb.value);
        if (checkbox.checked) selectedMenuIds.add(id);
        else selectedMenuIds.delete(id);
    });
    updateMenuTable(); // To update button visibility
}

function toggleSelectMenu(id) {
    if (selectedMenuIds.has(id)) selectedMenuIds.delete(id);
    else selectedMenuIds.add(id);
    
    // Update "Select All" checkbox state visually
    const allChecked = Array.from(document.querySelectorAll('.menu-checkbox')).every(cb => cb.checked);
    const headerCheckbox = document.querySelector('thead input[type="checkbox"]');
    if (headerCheckbox) headerCheckbox.checked = allChecked;

    updateMenuTable(); // To update button visibility
}

async function deleteSelectedMenuItems() {
    if (selectedMenuIds.size === 0) return;
    
    const selectedNames = allMenuItems
        .filter(item => selectedMenuIds.has(item.ID))
        .map(item => item.NAME)
        .join(', ');

    showModal(`Are you sure you want to delete these ${selectedMenuIds.size} items?\n\n${selectedNames}`, async () => {
        try {
            await fetch(`${API_BASE_URL}/menu/bulk-delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: Array.from(selectedMenuIds) })
            });
            selectedMenuIds.clear();
            renderMenuManagement();
        } catch (e) {
            alert("Failed to delete items");
        }
    });
}

function openBulkAddMenuModal() {
    const modal = document.getElementById('actionModal');
    const modalBox = document.getElementById('modalBox');
    modalBox.innerHTML = `
        <h3 style="margin-top:0;">Bulk Add Menu Items</h3>
        <div id="bulkItemsContainer" style="max-height: 300px; overflow-y: auto; margin-bottom: 10px;">
            <!-- Rows will be added here -->
        </div>
        <button class="main-btn" onclick="addBulkRow()" style="width:100%; margin-bottom:10px;"><i class="fa-solid fa-plus"></i> Add Another Item</button>
        <p id="bulkError" style="color: red; text-align: center; margin: 5px 0; min-height: 20px;"></p>
        <div style="margin-top: 15px; display: flex; gap: 10px; justify-content: center;">
            <button class="confirm-btn" onclick="saveBulkMenuItems()">Save All</button>
            <button class="cancel-btn" onclick="closeModal()">Cancel</button>
        </div>
    `;
    modal.style.display = 'flex';
    addBulkRow(); // Add first row by default
}

function addBulkRow() {
    const container = document.getElementById('bulkItemsContainer');
    const div = document.createElement('div');
    div.className = 'bulk-row';
    div.style.display = 'flex';
    div.style.gap = '5px';
    div.style.marginBottom = '5px';
    div.innerHTML = `
        <input type="text" placeholder="Name" class="bulk-name" style="flex:2; padding:5px;">
        <select class="bulk-category" style="flex:1; padding:5px;">
            <option value="Starters">Starters</option>
            <option value="Main Course">Main Course</option>
            <option value="Beverages">Beverages</option>
            <option value="Desserts">Desserts</option>
        </select>
        <input type="number" placeholder="Price" class="bulk-price" style="flex:1; padding:5px;">
        <button onclick="this.parentElement.remove()" style="background:#dc3545; color:white; border:none; border-radius:4px; cursor:pointer;">&times;</button>
    `;
    container.appendChild(div);
}

async function saveBulkMenuItems() {
    const rows = document.querySelectorAll('.bulk-row');
    const items = [];
    const names = new Set();
    let hasError = false;
    const errorEl = document.getElementById('bulkError');
    errorEl.textContent = '';

    // Get existing names for validation (case-insensitive)
    const existingNames = new Set(allMenuItems.map(i => i.NAME.toLowerCase()));

    rows.forEach(row => {
        const nameInput = row.querySelector('.bulk-name');
        const name = nameInput.value.trim();
        const category = row.querySelector('.bulk-category').value;
        const price = row.querySelector('.bulk-price').value;
        
        // Reset style
        nameInput.style.border = '1px solid #ccc';

        if (name) {
            const lowerName = name.toLowerCase();
            
            // Check for duplicates within the current batch
            if (names.has(lowerName)) {
                nameInput.style.border = '2px solid red';
                hasError = true;
                errorEl.textContent = `Duplicate name in list: "${name}"`;
                return;
            }
            
            // Check for duplicates against existing menu
            if (existingNames.has(lowerName)) {
                nameInput.style.border = '2px solid red';
                hasError = true;
                errorEl.textContent = `Item already exists in menu: "${name}"`;
                return;
            }

            names.add(lowerName);

            if (price) {
                items.push({ name, category, price });
            }
        }
    });

    if (hasError) return;
    if (items.length === 0) {
        errorEl.textContent = "Please add at least one valid item.";
        return;
    }

    try {
        await fetch(`${API_BASE_URL}/menu/bulk`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ items })
        });
        closeModal();
        renderMenuManagement();
    } catch (e) {
        errorEl.textContent = "Failed to add items";
    }
}

function openMenuModal(item = null) {
    editingMenuItemId = item ? item.ID : null;
    const modal = document.getElementById('actionModal');
    const modalBox = document.getElementById('modalBox');
    modalBox.innerHTML = `
        <h3 style="margin-top:0;">${item ? 'Edit Menu Item' : 'Add Menu Item'}</h3>
        <input type="text" id="menuName" placeholder="Item Name" value="${item ? item.NAME : ''}" style="width: 100%; padding: 8px; margin: 8px 0; box-sizing: border-box;">
        <select id="menuCategory" style="width: 100%; padding: 8px; margin: 8px 0; box-sizing: border-box;">
            <option value="Starters" ${item && item.CATEGORY === 'Starters' ? 'selected' : ''}>Starters</option>
            <option value="Main Course" ${item && (!item.CATEGORY || item.CATEGORY === 'Main Course') ? 'selected' : ''}>Main Course</option>
            <option value="Beverages" ${item && item.CATEGORY === 'Beverages' ? 'selected' : ''}>Beverages</option>
            <option value="Desserts" ${item && item.CATEGORY === 'Desserts' ? 'selected' : ''}>Desserts</option>
        </select>
        <input type="number" id="menuPrice" placeholder="Price (₹)" value="${item ? item.PRICE : ''}" style="width: 100%; padding: 8px; margin: 8px 0; box-sizing: border-box;">
        
        <label style="display:block; text-align:left; font-size:12px; margin-top:5px;">Item Image ${item ? '(Leave empty to keep current)' : ''}</label>
        ${item && item.IMAGE_URL ? `<img src="${item.IMAGE_URL}" style="width: 50px; height: 50px; object-fit: cover; margin-bottom: 5px;">` : ''}
        <input type="file" id="menuImageFile" accept="image/*" style="width: 100%; padding: 8px; margin: 5px 0 8px 0; box-sizing: border-box;">
        
        <div style="margin-top: 15px; display: flex; gap: 10px; justify-content: center;">
            <button class="confirm-btn" onclick="saveMenuItem()">${item ? 'Update' : 'Add Item'}</button>
            <button class="cancel-btn" onclick="closeModal()">Cancel</button>
        </div>
    `;
    modal.style.display = 'flex';
}

async function saveMenuItem() {
    const name = document.getElementById('menuName').value;
    const category = document.getElementById('menuCategory').value;
    const price = document.getElementById('menuPrice').value;
    const fileInput = document.getElementById('menuImageFile');

    if (!name || !price) return alert("Name and Price are required");

    try {
        let imageUrl = undefined;
        if (fileInput.files.length > 0) {
            showLoading("Processing image...");
            imageUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = e => resolve(e.target.result);
                reader.onerror = reject;
                reader.readAsDataURL(fileInput.files[0]);
            });
        } else if (!editingMenuItemId) {
            imageUrl = '';
        }

        const payload = { name, price, category };
        if (imageUrl !== undefined) payload.imageUrl = imageUrl;

        let url = `${API_BASE_URL}/menu`;
        let method = 'POST';

        if (editingMenuItemId) {
            url = `${API_BASE_URL}/menu/${editingMenuItemId}`;
            method = 'PUT';
        }

        await fetch(url, {
            method: method,
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        });
        closeModal();
        renderMenuManagement();
    } catch (e) {
        alert("Failed to add item");
    }
}

async function deleteMenuItem(id) {
    if(!confirm("Delete this item?")) return;
    try {
        await fetch(`${API_BASE_URL}/menu/${id}`, { method: 'DELETE' });
        renderMenuManagement();
    } catch (e) { alert("Failed to delete"); }
}

// --- REPORTS (OWNER ONLY) ---
async function loadChartJs() {
    if (window.Chart) return;
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/chart.js/dist/chart.umd.min.js';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

let revenueChartInstance = null;

async function renderReports(viewType = 'daily') {
    const container = document.getElementById('reportsContainer');
    if (!container) return;

    // Preserve existing dates if inputs exist
    let startVal = document.getElementById('reportStartDate')?.value;
    let endVal = document.getElementById('reportEndDate')?.value;

    // Default dates if not set: First day of current month to today
    if (!startVal) {
        const now = new Date();
        startVal = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    }
    if (!endVal) {
        endVal = new Date().toISOString().split('T')[0];
    }

    container.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 15px; margin-bottom: 20px;">
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
                <h2 style="margin:0;">Revenue Reports</h2>
                <div style="display: flex; gap: 10px;">
                    <button class="main-btn" onclick="renderReports('daily')" style="${viewType === 'daily' ? 'background:#0056b3; border: 1px solid #004494;' : 'background: #6c757d;'}">Daily</button>
                    <button class="main-btn" onclick="renderReports('monthly')" style="${viewType === 'monthly' ? 'background:#0056b3; border: 1px solid #004494;' : 'background: #6c757d;'}">Monthly</button>
                </div>
            </div>

            <div style="display: flex; gap: 10px; align-items: center; background: #fff; padding: 15px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); flex-wrap: wrap;">
                <label style="font-weight:500;">From:</label>
                <input type="date" id="reportStartDate" value="${startVal}" style="padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
                <label style="font-weight:500;">To:</label>
                <input type="date" id="reportEndDate" value="${endVal}" style="padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
                <button class="confirm-btn" onclick="renderReports('${viewType}')"><i class="fa-solid fa-filter"></i> Filter</button>
            </div>

            <div style="display: flex; gap: 20px; justify-content: space-around; background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.05);">
                <div style="text-align: center;">
                    <h4 style="margin:0; color: #666; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">Total Revenue</h4>
                    <h2 style="margin:5px 0; color: #28a745; font-size: 28px;" id="reportTotalRevenue">₹0</h2>
                </div>
                <div style="text-align: center; border-left: 1px solid #eee; padding-left: 20px;">
                    <h4 style="margin:0; color: #666; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">Transactions</h4>
                    <h2 style="margin:5px 0; color: #007bff; font-size: 28px;" id="reportTotalCount">0</h2>
                </div>
            </div>
        </div>

        <div style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); height: 400px; position: relative;">
            <canvas id="revenueChart"></canvas>
        </div>
    `;

    // Dark mode adjustments
    if (document.body.classList.contains('dark-mode')) {
        container.querySelectorAll('div[style*="background: white"], div[style*="background: #fff"]').forEach(d => {
            d.style.background = '#242526';
            d.style.color = '#e4e6eb';
        });
        container.querySelectorAll('input').forEach(i => {
            i.style.background = '#3a3b3c';
            i.style.color = '#e4e6eb';
            i.style.border = '1px solid #4e4f50';
        });
    }

    showLoading("Loading chart data...");

    try {
        await loadChartJs();
        const response = await fetch(`${API_BASE_URL}/history?hotelName=${encodeURIComponent(getContextHotel())}`);
        const history = await response.json();
        
        closeModal();

        // Filter Data
        const start = new Date(startVal);
        start.setHours(0,0,0,0);
        const end = new Date(endVal);
        end.setHours(23,59,59,999);

        const filteredHistory = history.filter(record => {
            const d = new Date(record.CHECK_OUT_TIME);
            return d >= start && d <= end;
        });

        // Calculate Totals
        const totalRevenue = filteredHistory.reduce((sum, r) => sum + r.FINAL_AMOUNT, 0);
        const totalCount = filteredHistory.length;

        document.getElementById('reportTotalRevenue').textContent = '₹' + totalRevenue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        document.getElementById('reportTotalCount').textContent = totalCount;

        // Process for Chart
        const dataMap = {};
        
        filteredHistory.forEach(record => {
            const dateObj = new Date(record.CHECK_OUT_TIME);
            let key;
            if (viewType === 'daily') {
                key = dateObj.toISOString().split('T')[0];
            } else {
                key = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;
            }
            
            if (!dataMap[key]) dataMap[key] = 0;
            dataMap[key] += record.FINAL_AMOUNT;
        });

        const labels = Object.keys(dataMap).sort();
        const data = labels.map(k => dataMap[k]);

        // Render Chart
        const ctx = document.getElementById('revenueChart').getContext('2d');
        if (revenueChartInstance) revenueChartInstance.destroy();

        const isDark = document.body.classList.contains('dark-mode');
        const textColor = isDark ? '#e4e6eb' : '#666';
        const gridColor = isDark ? '#3a3b3c' : '#ddd';

        revenueChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: `Revenue (${viewType})`,
                    data: data,
                    backgroundColor: 'rgba(0, 123, 255, 0.6)',
                    borderColor: 'rgba(0, 123, 255, 1)',
                    borderWidth: 1,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { labels: { color: textColor } },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) label += ': ';
                                if (context.parsed.y !== null) {
                                    label += new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(context.parsed.y);
                                }
                                return label;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            color: textColor,
                            callback: function(value) { return '₹' + value; }
                        },
                        grid: { color: gridColor }
                    },
                    x: {
                        ticks: { color: textColor },
                        grid: { color: gridColor }
                    }
                }
            }
        });

    } catch (e) {
        console.error(e);
        container.innerHTML += '<p style="color: red; text-align: center;">Failed to load reports.</p>';
        closeModal();
    }
}

// --- INITIAL DATA LOAD ---
document.addEventListener('DOMContentLoaded', async () => {
    showLoading('Please wait, data is loading...');
    try {
        await applyUIPermissions();
        const firstVisibleTabLink = document.querySelector('.sidebar ul li:not([style*="display: none"])');
        if (firstVisibleTabLink) {
            const tabId = firstVisibleTabLink.getAttribute('onclick').match(/'([^']+)'/)[1];
            if (tabId) openTab(tabId, firstVisibleTabLink);
        }
        
        const loadPromises = [];

        // Only render standard dashboard items if not a special role
        if (user.role !== 'Chef' && user.role !== 'Waiter' && user.role !== 'Housekeeping') {
            loadPromises.push(renderRooms());
            loadPromises.push(renderAvailability());
            loadPromises.push(renderGuestsAndBookings());
            loadPromises.push(renderOnlineBookings());
            if (user.role !== 'Employee') {
                loadPromises.push(renderHistory());
            }
            if (user.role === 'Owner' || user.role === 'Admin') {
                loadPromises.push(renderAccessTable());
                
                // Inject Menu Management Tab for Owner
                const sidebarList = document.querySelector('.sidebar ul');
                const li = document.createElement('li');
                li.innerHTML = '<i class="fa-solid fa-book-open"></i> Menu';
                li.onclick = function() { openTab('menuManagementContainer', this); renderMenuManagement(); };
                sidebarList.insertBefore(li, sidebarList.lastElementChild); // Insert before logout or last item

                const div = document.createElement('div');
                div.id = 'menuManagementContainer';
                div.className = 'tab-content';
                div.innerHTML = `
                    <h2>Menu Management</h2>
                    <div style="margin-bottom: 15px;">
                        <input type="text" placeholder="Search items..." oninput="handleMenuSearch(this.value)" style="padding: 8px; width: 100%; max-width: 300px; border: 1px solid #ccc; border-radius: 4px;">
                    </div>
                    <div id="menuManagementList"></div>
                    <div id="menuPaginationControls" style="margin-top: 15px; text-align: center; display: flex; justify-content: center; gap: 5px;"></div>
                `;
                document.querySelector('.main-content').appendChild(div);
                
                // Add styles for pagination buttons
                const style = document.createElement('style');
                style.innerHTML = `
                    .page-btn { padding: 5px 10px; border: 1px solid #ddd; background: white; cursor: pointer; border-radius: 4px; }
                    .page-btn.active { background: #007bff; color: white; border-color: #007bff; }
                    .page-btn:disabled { opacity: 0.5; cursor: not-allowed; }
                    .page-btn:hover:not(:disabled) { background: #f0f0f0; }
                `;
                document.head.appendChild(style);
            }
        }
        loadPromises.push(refreshUserProfile());
        await Promise.all(loadPromises);
    } catch (error) {
        console.error("Error initializing dashboard:", error);
    } finally {
        closeModal();
    }

    // Add Sidebar Extras (Dark Mode & Dine-in)
    const sidebarList = document.querySelector('.sidebar ul');
    if (sidebarList) {
        // Dark Mode Toggle
        const darkLi = document.createElement('li');
        darkLi.id = 'darkModeToggle';
        darkLi.onclick = toggleDarkMode;
        sidebarList.appendChild(darkLi);

        // Guest Dine-in Link (Owner Only)
        if (user.role === 'Owner' || user.role === 'Admin') {
            const dineLi = document.createElement('li');
            dineLi.innerHTML = '<i class="fa-solid fa-utensils"></i> Guest Dine-in';
            dineLi.onclick = () => window.open('dinein.html', '_blank');
            sidebarList.appendChild(dineLi);

            // Reports Link (Owner Only)
            const reportLi = document.createElement('li');
            reportLi.innerHTML = '<i class="fa-solid fa-chart-line"></i> Reports';
            reportLi.onclick = function() { openTab('reportsContainer', this); renderReports(); };
            sidebarList.appendChild(reportLi);

            // Create Reports Container
            const reportDiv = document.createElement('div');
            reportDiv.id = 'reportsContainer';
            reportDiv.className = 'tab-content';
            document.querySelector('.main-content').appendChild(reportDiv);
        }

        // Logout Button (Bottom of Sidebar)
        // Remove any existing logout button to prevent duplicates, and remove Change Password (moved to profile)
        Array.from(sidebarList.children).forEach(li => {
            const text = li.textContent.trim();
            if (text.includes('Logout') || text.includes('Change Password')) li.remove();
        });

        const logoutLi = document.createElement('li');
        logoutLi.innerHTML = '<i class="fa-solid fa-right-from-bracket"></i> Logout';
        logoutLi.onclick = logout;
        logoutLi.style.marginTop = 'auto'; // Pushes to the bottom
        sidebarList.appendChild(logoutLi);
    }
    
    injectDarkModeStyles();
    const isDark = localStorage.getItem('hmsDarkMode') === 'true';
    if (isDark) document.body.classList.add('dark-mode');
    updateDarkModeButton(isDark);
});