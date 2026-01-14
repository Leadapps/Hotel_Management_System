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
    if (!identifier) return alert('Please enter your registered email or mobile number.');

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
            alert(result.message || 'Guest not found. Please check your details.');
        }
    } catch (error) {
        console.error(error);
        alert('Error verifying guest details.');
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
        return showNotification('Out of Stock', 'Sorry, this item is currently unavailable.');
    }

    // Map DB columns to Cart format
    const cartItem = {
        id: item.ID,
        name: item.NAME,
        price: item.PRICE
    };
    cart.push(cartItem);
    updateCartUI();
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
    if (!currentRoom) return alert('Room number missing.');
    
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
            showNotification('Order Placed!', 'Your food is being prepared and will be charged to your room.');
            cart = [];
            updateCartUI();
        } else {
            const result = await response.json();
            showNotification('Error', result.message || 'Could not place order. Please try again.');
        }
    } catch (error) {
        console.error(error);
        showNotification('Error', 'Network error. Please try again.');
    }
}

function openServiceModal() {
    document.getElementById('serviceModal').style.display = 'flex';
    document.getElementById('serviceComments').value = '';
}

async function submitServiceRequest() {
    const requestType = document.getElementById('serviceType').value;
    const comments = document.getElementById('serviceComments').value.trim();

    if (!currentRoom) return alert('Room number missing. Please verify guest first.');

    try {
        const response = await fetch(`${API_BASE_URL}/service-requests`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ roomNumber: currentRoom, requestType, comments, hotelName: currentUser.hotelName })
        });

        const result = await response.json();
        document.getElementById('serviceModal').style.display = 'none';
        
        showNotification(response.ok ? 'Request Sent' : 'Error', result.message);
    } catch (e) {
        console.error("Service Request Failed:", e);
        showNotification('Network Error', 'Failed to send request.');
    }
}

function showNotification(title, msg) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalMsg').textContent = msg;
    document.getElementById('notificationModal').style.display = 'flex';
}