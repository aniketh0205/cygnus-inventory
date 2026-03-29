// Global Error Handler
window.onerror = function(msg, url, line) {
    console.error("Application Error: " + msg + "\nLine: " + line);
};

// Supabase REST Configuration (No External Libraries Required)
const SUPABASE_URL = 'https://thocxtjnxufdxaucjuow.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRob2N4dGpueHVmZHhhdWNqdW93Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3ODIyNjcsImV4cCI6MjA5MDM1ODI2N30.jiUMKyOxcdD08miRw6NEoYtR_G-pptI1QtH0BTeyd9k';

const sbFetch = async (endpoint, options = {}) => {
    const defaultHeaders = {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
    };
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
        ...options,
        headers: { ...defaultHeaders, ...options.headers }
    });
    if (!res.ok) throw new Error(`API Error: ${res.statusText}`);
    if (res.status === 204) return null;
    return res.json();
};

// Global State
const DB = {
    users: [],
    items: [],
    logs: [],
    currentUser: null
};

// UI Elements
const els = {
    screens: document.querySelectorAll('.screen'),
    authScreen: document.getElementById('auth-screen'),
    dashboardScreen: document.getElementById('dashboard-screen'),
    loginForm: document.getElementById('login-form'),
    logoutBtn: document.getElementById('logout-btn'),
    
    displayName: document.getElementById('display-name'),
    displayRole: document.getElementById('display-role'),
    userAvatar: document.getElementById('user-avatar'),
    adminOnlyElements: document.querySelectorAll('.admin-only'),
    
    navItems: document.querySelectorAll('.nav-item'),
    views: document.querySelectorAll('.view'),
    viewTitle: document.getElementById('view-title'),
    
    inventoryGrid: document.getElementById('inventory-grid'),
    categoryFilters: document.querySelectorAll('.filter-btn'),
    searchInput: document.getElementById('search-input'),
    addItemBtn: document.getElementById('add-item-btn'),
    
    closeModalBtns: document.querySelectorAll('.close-modal'),
    
    itemModal: document.getElementById('item-modal'),
    itemForm: document.getElementById('item-form'),
    itemModalTitle: document.getElementById('item-modal-title'),
    itemIdInput: document.getElementById('item-id'),
    itemNameInput: document.getElementById('item-name'),
    itemCatInput: document.getElementById('item-category'),
    itemQtyInput: document.getElementById('item-quantity'),
    itemDescInput: document.getElementById('item-description'),
    itemNotesInput: document.getElementById('item-notes'),
    itemImageInput: document.getElementById('item-image'),
    itemImageBase64: document.getElementById('item-image-base64'),
    imagePreview: document.getElementById('image-preview'),
    triggerUploadBtn: document.getElementById('trigger-upload'),
    
    userModal: document.getElementById('user-modal'),
    userForm: document.getElementById('user-form'),
    addUserBtn: document.getElementById('add-user-btn'),
    usersTbody: document.getElementById('users-tbody'),
    
    logsTbody: document.getElementById('logs-tbody'),
    settingsForm: document.getElementById('settings-form'),
    newAdminUser: document.getElementById('new-admin-user'),
    newAdminPass: document.getElementById('new-admin-pass'),
    
    sidebar: document.querySelector('.sidebar'),
    sidebarToggle: document.getElementById('sidebar-toggle'),
    
    toastContainer: document.getElementById('toast-container')
};

let currentCategory = 'All';
let searchTerm = '';

// Utilities
const generateId = () => Math.random().toString(36).substr(2, 9);
const showToast = (message, type = 'success') => {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    els.toastContainer.appendChild(toast);
    setTimeout(() => { toast.remove(); }, 3000); 
};

// --- DATA LAYER --- //
async function syncLocalState() {
    try {
        const [usersData, itemsData, logsData] = await Promise.all([
            sbFetch('users?select=*'),
            sbFetch('items?select=*'),
            sbFetch('access_logs?select=*&order=timestamp.desc')
        ]);
        if(usersData) DB.users = usersData;
        if(itemsData) DB.items = itemsData;
        if(logsData) DB.logs = logsData;
    } catch(e) { console.error("Database sync error:", e); }
}

async function logAccess(username, action) {
    try {
        await sbFetch('access_logs', {
            method: 'POST',
            body: JSON.stringify({ username, action })
        });
    } catch(e) { console.error('Failed to log access', e); }
}

// --- AUTHENTICATION --- //
els.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.textContent = 'Authenticating...';
    btn.disabled = true;

    await syncLocalState();

    const userIn = document.getElementById('username').value.trim();
    const passIn = document.getElementById('password').value.trim();
    
    const validUser = DB.users.find(u => u.username.toLowerCase() === userIn.toLowerCase() && u.password === passIn);
    
    if (validUser) {
        DB.currentUser = validUser;
        await logAccess(validUser.username, 'Login');
        initDashboard();
        showToast(`Welcome back, ${validUser.username}!`);
    } else {
        showToast('Invalid username or password', 'error');
    }
    
    btn.textContent = 'Access Inventory';
    btn.disabled = false;
});

els.logoutBtn.addEventListener('click', async () => {
    if(DB.currentUser) await logAccess(DB.currentUser.username, 'Logout');
    DB.currentUser = null;
    switchScreen('auth-screen');
    els.loginForm.reset();
});

// --- SETTINGS --- //
els.settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if(DB.currentUser.role !== 'admin') return;
    
    const newUsername = els.newAdminUser.value.trim();
    const newPassword = els.newAdminPass.value.trim();
    
    if(!newUsername || !newPassword) return;

    try {
        await sbFetch(`users?id=eq.${DB.currentUser.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ username: newUsername, password: newPassword })
        });
        
        await logAccess(newUsername, 'Updated Master Credentials');
        
        showToast('Credentials updated! Please login again.');
        setTimeout(() => els.logoutBtn.click(), 2000);
    } catch(err) {
        showToast('Failed to update credentials. Username might be taken.', 'error');
    }
});

// --- SIDEBAR TOGGLE --- //
if (els.sidebarToggle) {
    // start collapsed on desktop by default
    els.sidebar.classList.add('collapsed');
    
    els.sidebarToggle.addEventListener('click', () => {
        els.sidebar.classList.toggle('collapsed');
    });
}

// --- NAVIGATION --- //
const switchScreen = (screenId) => {
    els.screens.forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
};

const switchView = async (viewId, title) => {
    els.views.forEach(v => v.classList.remove('active'));
    document.getElementById(`view-${viewId}`).classList.add('active');
    
    els.navItems.forEach(n => n.classList.remove('active'));
    const activeNav = document.querySelector(`.nav-item[data-view="${viewId}"]`);
    if(activeNav) activeNav.classList.add('active');
    
    els.viewTitle.textContent = title;
    
    if(viewId === 'users' || viewId === 'logs') {
        await syncLocalState();
        if(viewId === 'users') renderUsers();
        if(viewId === 'logs') renderLogs();
    }
    if(viewId === 'settings') {
        els.newAdminUser.value = DB.currentUser.username;
        els.newAdminPass.value = '';
    }
};

els.navItems.forEach(btn => {
    btn.addEventListener('click', (e) => {
        const view = e.currentTarget.dataset.view;
        const title = e.currentTarget.textContent.trim();
        switchView(view, title);
    });
});

const initDashboard = () => {
    switchScreen('dashboard-screen');
    
    els.displayName.textContent = DB.currentUser.username;
    els.displayRole.textContent = DB.currentUser.role;
    els.userAvatar.textContent = DB.currentUser.username.substring(0, 2).toUpperCase();
    
    if (DB.currentUser.role === 'admin') {
        els.adminOnlyElements.forEach(el => el.classList.remove('hidden'));
    } else {
        els.adminOnlyElements.forEach(el => el.classList.add('hidden'));
    }
    
    if (DB.currentUser.role === 'admin' || DB.currentUser.role === 'team') {
        els.addItemBtn.classList.remove('hidden');
    } else {
        els.addItemBtn.classList.add('hidden');
    }
    
    switchView('inventory', 'Inventory Overview');
    renderInventory();
};

// --- RENDERERS --- //
const renderInventory = () => {
    let filtered = DB.items;
    
    if (currentCategory !== 'All') {
        filtered = filtered.filter(i => i.category === currentCategory);
    }
    if (searchTerm) {
        const term = searchTerm.toLowerCase();
        filtered = filtered.filter(i => 
            i.name.toLowerCase().includes(term) || 
            (i.description && i.description.toLowerCase().includes(term))
        );
    }
    
    els.inventoryGrid.innerHTML = '';
    
    if (filtered.length === 0) {
        els.inventoryGrid.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📦</div>
                <h3>No items found</h3>
                <p>Try a different search or add a new item.</p>
            </div>
        `;
        return;
    }
    
    filtered.forEach(item => {
        const canEdit = DB.currentUser.role === 'admin' || DB.currentUser.role === 'team';
        const actionsHtml = canEdit ? `
            <div class="item-actions">
                <button class="action-btn edit" onclick="editItem('${item.id}')" title="Edit">✏️</button>
                <button class="action-btn delete" onclick="deleteItem('${item.id}')" title="Delete">🗑️</button>
            </div>
        ` : '';
        
        const imageHtml = item.image 
            ? `<img src="${item.image}" class="item-image" alt="${item.name}">`
            : `<div class="item-image-placeholder">📦</div>`;
        const notesHtml = item.notes ? `<div class="item-notes"><strong>Notes: </strong>${item.notes}</div>` : '';
            
        const card = document.createElement('div');
        card.className = 'item-card';
        card.innerHTML = `
            ${imageHtml}
            <div class="item-content">
                <div class="item-header">
                    <h3 class="item-title">${item.name}</h3>
                    <span class="item-category-badge">${item.category}</span>
                </div>
                <p class="item-desc">${item.description || 'No description provided.'}</p>
                ${notesHtml}
                <div class="item-footer">
                    <span class="item-quantity">Qty: ${item.quantity}</span>
                    ${actionsHtml}
                </div>
            </div>
        `;
        els.inventoryGrid.appendChild(card);
    });
};

const renderUsers = () => {
    els.usersTbody.innerHTML = '';
    DB.users.forEach(user => {
        const isSelf = user.id === DB.currentUser.id;
        const deleteBtn = !isSelf && user.role !== 'admin' 
            ? `<button class="action-btn delete" onclick="deleteUser('${user.id}')" title="Revoke">🗑️</button>`
            : '';
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${user.username} ${isSelf ? '(You)' : ''}</td>
            <td><span class="role-badge">${user.role}</span></td>
            <td><span class="status-badge ${user.status === 'temporary' ? 'temp' : ''}">${user.status}</span></td>
            <td>${deleteBtn}</td>
        `;
        els.usersTbody.appendChild(row);
    });
};

const renderLogs = () => {
    els.logsTbody.innerHTML = '';
    DB.logs.forEach(log => {
        const d = new Date(log.timestamp);
        const timeStr = `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${timeStr}</td>
            <td><strong>${log.username}</strong></td>
            <td><span class="status-badge">${log.action}</span></td>
        `;
        els.logsTbody.appendChild(row);
    });
};

// --- INTERACTIONS & FORMS --- //
els.categoryFilters.forEach(btn => {
    btn.addEventListener('click', (e) => {
        els.categoryFilters.forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        currentCategory = e.currentTarget.dataset.category;
        renderInventory();
    });
});

els.searchInput.addEventListener('input', (e) => {
    searchTerm = e.target.value.trim();
    renderInventory();
});

const openModal = (modalId) => { els[modalId].classList.remove('hidden'); };
const closeModals = () => { els.closeModalBtns.forEach(btn => btn.closest('.modal-overlay').classList.add('hidden')); };
els.closeModalBtns.forEach(btn => btn.addEventListener('click', closeModals));

// Handle Item Modal
els.addItemBtn.addEventListener('click', () => {
    els.itemForm.reset();
    els.itemIdInput.value = '';
    els.itemModalTitle.textContent = 'Add New Item';
    els.itemImageBase64.value = '';
    els.imagePreview.style.backgroundImage = 'none';
    els.imagePreview.innerHTML = '<span class="icon" style="font-size: 2rem;">📸</span><p style="margin-top: 0.5rem; font-size: 0.875rem;">Upload Picture</p>';
    openModal('itemModal');
});

els.triggerUploadBtn.addEventListener('click', () => els.itemImageInput.click());

els.itemImageInput.addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(event) {
            const img = new Image();
            img.onload = function() {
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 600;
                let width = img.width;
                let height = img.height;
                if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
                els.itemImageBase64.value = dataUrl;
                els.imagePreview.style.backgroundImage = `url(${dataUrl})`;
                els.imagePreview.innerHTML = '';
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    }
});

els.itemForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('item-save-btn');
    btn.disabled = true;
    btn.textContent = 'Saving...';
    
    const newItem = {
        name: els.itemNameInput.value,
        category: els.itemCatInput.value,
        quantity: parseInt(els.itemQtyInput.value, 10),
        description: els.itemDescInput.value,
        notes: els.itemNotesInput.value,
        image: els.itemImageBase64.value
    };
    
    try {
        if (els.itemIdInput.value) {
            newItem.id = els.itemIdInput.value;
            await sbFetch(`items?id=eq.${newItem.id}`, {
                method: 'PATCH',
                body: JSON.stringify(newItem)
            });
            await logAccess(DB.currentUser.username, `Updated item: ${newItem.name}`);
            showToast('Item updated successfully');
        } else {
            newItem.id = generateId();
            await sbFetch('items', {
                method: 'POST',
                body: JSON.stringify(newItem)
            });
            await logAccess(DB.currentUser.username, `Added new item: ${newItem.name}`);
            showToast('Item added successfully');
        }
        await syncLocalState();
        renderInventory();
        closeModals();
    } catch(err) {
        console.error(err);
        showToast('Failed to save', 'error');
    }
    
    btn.disabled = false;
    btn.textContent = 'Save Item';
});

window.editItem = async (id) => {
    const item = DB.items.find(i => i.id === id);
    if (!item) return;
    
    els.itemIdInput.value = item.id;
    els.itemNameInput.value = item.name;
    els.itemCatInput.value = item.category;
    els.itemQtyInput.value = item.quantity;
    els.itemDescInput.value = item.description || '';
    els.itemNotesInput.value = item.notes || '';
    els.itemImageBase64.value = item.image || '';
    
    if (item.image) {
        els.imagePreview.style.backgroundImage = `url(${item.image})`;
        els.imagePreview.innerHTML = '';
    } else {
        els.imagePreview.style.backgroundImage = 'none';
        els.imagePreview.innerHTML = '<span class="icon" style="font-size: 2rem;">📸</span><p style="margin-top: 0.5rem; font-size: 0.875rem;">Upload Picture</p>';
    }
    
    els.itemModalTitle.textContent = 'Edit Item';
    openModal('itemModal');
};

window.deleteItem = async (id) => {
    if(confirm('Are you sure you want to delete this item?')) {
        try {
            const item = DB.items.find(i => i.id === id);
            await sbFetch(`items?id=eq.${id}`, { method: 'DELETE' });
            await logAccess(DB.currentUser.username, `Deleted item: ${item ? item.name : id}`);
            await syncLocalState();
            renderInventory();
            showToast('Item deleted successfully');
        } catch(e) { showToast('Failure deleting item', 'error'); }
    }
};

els.addUserBtn.addEventListener('click', () => {
    els.userForm.reset();
    openModal('userModal');
});

els.userForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    
    const username = document.getElementById('new-username').value.trim();
    let password = document.getElementById('new-password').value.trim();
    if (!password) password = Math.random().toString(36).substr(2, 6);
    
    if(DB.users.some(u => u.username === username)) {
        showToast('Username already exists', 'error');
        btn.disabled = false;
        return;
    }
    
    const roleLevel = document.getElementById('new-user-role').value;
    
    try {
        await sbFetch('users', {
            method: 'POST',
            body: JSON.stringify({
                id: generateId(),
                username,
                password,
                role: roleLevel,
                status: 'temporary'
            })
        });
        
        await logAccess(DB.currentUser.username, `Created temporary access for: ${username}`);
        await syncLocalState();
        renderUsers();
        closeModals();
        showToast(`User created in database!`);
        setTimeout(() => alert(`Temporary access generated:\nUsername: ${username}\nPassword: ${password}\n\nPlease share these credentials securely.`), 500);
    } catch(err) {
        showToast('Error syncing user', 'error');
    }
    btn.disabled = false;
});

window.deleteUser = async (id) => {
    if(confirm('Revoke access for this user across all devices?')) {
        try {
            const tempUser = DB.users.find(u => u.id === id);
            await sbFetch(`users?id=eq.${id}`, { method: 'DELETE' });
            await logAccess(DB.currentUser.username, `Revoked access for: ${tempUser ? tempUser.username : id}`);
            await syncLocalState();
            renderUsers();
            showToast('User access revoked');
        } catch(e) {}
    }
};

syncLocalState();
