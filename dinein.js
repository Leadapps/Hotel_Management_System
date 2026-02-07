const API_BASE_URL = '/api';

// --- AUTH CHECK ---
const currentUser = JSON.parse(localStorage.getItem('hmsCurrentUser'));
if (!currentUser) {
    window.location.href = 'room-login.html';
}

// Prevent back navigation for Room users to lock the screen
if (currentUser && currentUser.role === 'Room') {
    history.pushState(null, null, location.href);
    window.onpopstate = function () {
        history.go(1);
    };
}

// Auto-fill room number for Room users
document.addEventListener('DOMContentLoaded', () => {
    // Focus on input
    const input = document.getElementById('guestIdentifierInput');
    if(input) input.focus();
    injectContactButton();
});

// --- STYLES ---
function injectLoaderStyles() {
    const style = document.createElement('style');
    style.textContent = `
        .custom-loader { width: 40px; height: 40px; border: 4px solid #f3f3f3; border-top: 4px solid #007bff; border-radius: 50%; animation: spin 1s linear infinite; margin: 20px auto; }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    `;
    document.head.appendChild(style);
}
injectLoaderStyles();

let MENU_ITEMS = [];
let cart = [];
let currentRoom = null;
let menuPollInterval = null;

async function verifyGuest() {
    const identifier = document.getElementById('guestIdentifierInput').value.trim();
    if (!identifier) return showToast('Please enter your registered email or mobile number.', 'error');

    try {
        const response = await fetch(`${API_BASE_URL}/guest/verify-dinein`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                identifier, 
                hotelName: currentUser.hotelName 
            })
        });

        const result = await response.json();

        if (response.ok) {
            // Success
            currentRoom = result.roomNumber;
            
            // Update UI
            document.getElementById('guestAuthBox').style.display = 'none';
            document.getElementById('welcomeHeader').style.display = 'block';
            document.getElementById('guestNameDisplay').textContent = result.guestName;
            document.getElementById('roomNumberDisplay').textContent = currentRoom;
            
            document.getElementById('menuContainer').style.display = 'grid';
            renderMenu();

            // Start polling
            if (menuPollInterval) clearInterval(menuPollInterval);
            menuPollInterval = setInterval(() => renderMenu(true), 10000);
        } else {
            showToast(result.message || 'Guest not found. Please check your details.', 'error');
        }
    } catch (error) {
        console.error(error);
        showToast('Error verifying guest details.', 'error');
    }
}

async function renderMenu(isBackgroundUpdate = false) {
    const container = document.getElementById('menuContainer');
    if (!isBackgroundUpdate) container.innerHTML = '<div class="custom-loader"></div><p style="text-align:center; color:#666;">Loading menu...</p>';
    
    try {
        const response = await fetch(`${API_BASE_URL}/menu?hotelName=${encodeURIComponent(currentUser.hotelName)}`);
        MENU_ITEMS = await response.json();
    } catch (e) {
        if (!isBackgroundUpdate) container.innerHTML = '<p>Failed to load menu.</p>';
        return;
    }

    // Group items by category
    const categories = {};
    MENU_ITEMS.forEach(item => {
        const cat = item.CATEGORY || 'Main Course';
        if (!categories[cat]) categories[cat] = [];
        categories[cat].push(item);
    });

    container.innerHTML = Object.keys(categories).map(cat => `
        <h2 style="grid-column: 1/-1; border-bottom: 2px solid #ddd; padding-bottom: 10px; margin-top: 20px; color: #555;">${cat}</h2>
        ${categories[cat].map(item => `
            <div class="menu-item" style="${item.IS_AVAILABLE === 0 ? 'opacity: 0.6; background: #f9f9f9;' : ''}">
                ${item.IS_AVAILABLE === 0 ? '<div class="sold-out-badge">SOLD OUT</div>' : ''}
                <img src="${item.IMAGE_URL || 'https://via.placeholder.com/200?text=Food'}" alt="${item.NAME}" style="${item.IS_AVAILABLE === 0 ? 'filter: grayscale(100%);' : ''}">
                <h3>${item.NAME}</h3>
                <div class="price">₹${item.PRICE}</div>
                ${item.IS_AVAILABLE === 0 
                    ? '<button class="add-btn" disabled style="background:#ccc; cursor:not-allowed;">Out of Stock</button>' 
                    : `<button class="add-btn" onclick="addToCart(${item.ID})">Add to Order</button>`
                }
            </div>
        `).join('')}
    `).join('');
}

function addToCart(id) {
    const item = MENU_ITEMS.find(i => i.ID === id);
    
    if (item.IS_AVAILABLE === 0) {
        return showToast('Sorry, this item is currently unavailable.', 'error');
    }

    // Map DB columns to Cart format
    const cartItem = {
        id: item.ID,
        name: item.NAME,
        price: item.PRICE
    };
    cart.push(cartItem);
    updateCartUI();
    showToast(`${item.NAME} added to order`, 'success');
}

function updateCartUI() {
    const bar = document.getElementById('cartBar');
    const count = document.getElementById('cartCount');
    const total = document.getElementById('cartTotal');
    
    if (cart.length > 0) {
        bar.classList.add('visible');
        count.textContent = cart.length;
        total.textContent = cart.reduce((sum, item) => sum + item.price, 0);
    } else {
        bar.classList.remove('visible');
    }
}

async function placeOrder() {
    if (!currentRoom) return showToast('Room number missing.', 'error');
    
    const orderData = {
        roomNumber: currentRoom,
        items: cart,
        totalCost: cart.reduce((sum, item) => sum + item.price, 0),
        status: 'Pending', // Initial status for Chef
        timestamp: new Date().toISOString(),
        hotelName: currentUser.hotelName
    };

    try {
        const response = await fetch(`${API_BASE_URL}/food-orders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(orderData)
        });

        if (response.ok) { 
            showToast('Order Placed! Your food is being prepared.', 'success');
            cart = [];
            updateCartUI();
        } else {
            const result = await response.json();
            showToast(result.message || 'Could not place order. Please try again.', 'error');
        }
    } catch (error) {
        console.error(error);
        showToast('Network error. Please try again.', 'error');
    }
}

function openServiceModal() {
    document.getElementById('serviceModal').style.display = 'flex';
    document.getElementById('serviceComments').value = '';
}

async function submitServiceRequest() {
    const requestType = document.getElementById('serviceType').value;
    const comments = document.getElementById('serviceComments').value.trim();

    if (!currentRoom) return showToast('Room number missing. Please verify guest first.', 'error');

    try {
        const response = await fetch(`${API_BASE_URL}/service-requests`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ roomNumber: currentRoom, requestType, comments, hotelName: currentUser.hotelName })
        });

        const result = await response.json();
        document.getElementById('serviceModal').style.display = 'none';
        
        showToast(result.message, response.ok ? 'success' : 'error');
    } catch (e) {
        console.error("Service Request Failed:", e);
        showToast('Failed to send request.', 'error');
    }
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

function injectContactButton() {
    const authBox = document.getElementById('guestAuthBox');
    if (authBox && !document.getElementById('contactBtn')) {
        const btn = document.createElement('button');
        btn.id = 'contactBtn';
        btn.className = 'contact-hotel-btn main-btn';
        btn.innerHTML = '<i class="fa-solid fa-headset"></i> Contact Us';
        btn.style.marginTop = '15px';
        btn.style.width = '100%';
        btn.onclick = openContactModal;
        authBox.appendChild(btn);

        if (!document.getElementById('contactModal')) {
            const modal = document.createElement('div');
            modal.id = 'contactModal';
            modal.className = 'modal';
            modal.style.display = 'none';
            modal.innerHTML = `
                <div class="modal-overlay" onclick="closeContactModal()"></div>
                <div class="modal-box">
                    <h3><i class="fa-solid fa-hotel"></i> ${currentUser ? currentUser.hotelName : 'Hotel'}</h3>
                    <p style="color:#666; margin-bottom:20px;">Need assistance? Contact the front desk.</p>
                    <div style="background:#f8f9fa; padding:15px; border-radius:8px; margin-bottom:20px;">
                        <div style="font-size:18px; font-weight:bold; color:#007bff; margin-bottom:10px;">
                            <i class="fa-solid fa-phone"></i> Intercom: 9
                        </div>
                    </div>
                    <button class="cancel-btn" onclick="closeContactModal()" style="width:100%">Close</button>
                </div>
            `;
            document.body.appendChild(modal);
        }
    }
}

window.openContactModal = function() { 
    const modal = document.getElementById('contactModal');
    if(modal) modal.style.display = 'flex'; 
};
window.closeContactModal = function() { 
    const modal = document.getElementById('contactModal');
    if(modal) modal.style.display = 'none'; 
};