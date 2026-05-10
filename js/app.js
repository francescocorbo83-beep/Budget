// Default Data
const DEFAULT_CATEGORIES = [
    { id: 'cat-1', name: 'Stipendio', color: '#10b981', icon: 'fa-solid fa-money-bill-wave' },
    { id: 'cat-2', name: 'Casa', color: '#6366f1', icon: 'fa-solid fa-house' },
    { id: 'cat-3', name: 'Spesa Alimentare', color: '#f59e0b', icon: 'fa-solid fa-cart-shopping' },
    { id: 'cat-4', name: 'Trasporti', color: '#8b5cf6', icon: 'fa-solid fa-car' },
    { id: 'cat-5', name: 'Svago', color: '#ec4899', icon: 'fa-solid fa-gamepad' }
];

// App State
let state = {
    categories: [],
    transactions: [],
    lastSync: null
};

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    loadLocalData();
    initUI();
    updateDashboard();
});

function loadLocalData() {
    const localData = localStorage.getItem('nexbudget_data');
    if (localData) {
        state = JSON.parse(localData);
    } else {
        state.categories = [...DEFAULT_CATEGORIES];
        saveLocalData();
    }
}

function saveLocalData() {
    localStorage.setItem('nexbudget_data', JSON.stringify(state));
    // Trigger external sync if available
    if (window.gdriveSyncData) {
        window.gdriveSyncData(state);
    }
}

// Update state from external source (Google Drive)
window.updateStateFromCloud = function(cloudState) {
    if (cloudState && cloudState.categories) {
        state = cloudState;
        localStorage.setItem('nexbudget_data', JSON.stringify(state));
        updateDashboard();
        renderTransactions();
        renderCategories();
    }
}

// UI Initialization
function initUI() {
    // Sidebar Navigation
    const navLinks = document.querySelectorAll('.nav-links li');
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            
            const viewId = link.getAttribute('data-view');
            switchView(viewId);
            
            if (window.innerWidth <= 768) {
                document.querySelector('.sidebar').classList.remove('open');
            }
        });
    });

    // Mobile Menu
    document.querySelector('.mobile-menu-toggle').addEventListener('click', () => {
        document.querySelector('.sidebar').classList.toggle('open');
    });

    // Filters
    document.getElementById('filter-period').addEventListener('change', (e) => {
        const val = e.target.value;
        document.getElementById('month-filter-container').classList.toggle('hidden', val === 'annual');
        document.getElementById('year-filter-container').classList.toggle('hidden', val === 'monthly');
        updateDashboard();
    });

    // Default current month
    const now = new Date();
    document.getElementById('filter-month').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    document.getElementById('filter-year').value = now.getFullYear();

    document.getElementById('filter-month').addEventListener('change', updateDashboard);
    document.getElementById('filter-year').addEventListener('change', updateDashboard);

    // Modals
    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden'));
        });
    });

    // Transaction Form
    document.getElementById('btn-add-transaction').addEventListener('click', () => {
        document.getElementById('form-transaction').reset();
        document.getElementById('tx-id').value = '';
        document.getElementById('modal-tx-title').textContent = 'Nuova Transazione';
        populateCategorySelect();
        // Default date to today
        document.getElementById('tx-date').valueAsDate = new Date();
        document.getElementById('modal-transaction').classList.remove('hidden');
    });

    document.getElementById('form-transaction').addEventListener('submit', handleTransactionSubmit);

    // Category Form
    document.getElementById('btn-add-category').addEventListener('click', () => {
        document.getElementById('form-category').reset();
        document.getElementById('cat-id').value = '';
        document.getElementById('modal-cat-title').textContent = 'Nuova Categoria';
        document.getElementById('modal-category').classList.remove('hidden');
    });

    document.getElementById('form-category').addEventListener('submit', handleCategorySubmit);

    // Settings
    document.getElementById('btn-clear-data').addEventListener('click', () => {
        if(confirm('Sei sicuro di voler cancellare tutti i dati locali? (Non cancellerà i dati su Drive se non sincronizzati in modo distruttivo)')) {
            localStorage.removeItem('nexbudget_data');
            location.reload();
        }
    });

    // Render Initial Data
    renderTransactions();
    renderCategories();
}

function switchView(viewId) {
    document.querySelectorAll('.view-section').forEach(view => {
        view.classList.add('hidden');
    });
    document.getElementById(`view-${viewId}`).classList.remove('hidden');
    
    // Update Page Title
    const titles = {
        'dashboard': 'Dashboard',
        'transactions': 'Transazioni',
        'categories': 'Gestione Categorie',
        'settings': 'Impostazioni'
    };
    document.getElementById('page-title').textContent = titles[viewId];

    if (viewId === 'dashboard') updateDashboard();
    if (viewId === 'transactions') renderTransactions();
    if (viewId === 'categories') renderCategories();
}

// Data Handling: Transactions
function handleTransactionSubmit(e) {
    e.preventDefault();
    
    const id = document.getElementById('tx-id').value || `tx-${Date.now()}`;
    const tx = {
        id: id,
        title: document.getElementById('tx-title').value,
        type: document.getElementById('tx-type').value,
        amount: parseFloat(document.getElementById('tx-amount').value),
        nature: document.getElementById('tx-nature').value,
        frequency: document.getElementById('tx-frequency').value,
        date: document.getElementById('tx-date').value,
        categoryId: document.getElementById('tx-category').value
    };

    const existingIndex = state.transactions.findIndex(t => t.id === id);
    if (existingIndex >= 0) {
        state.transactions[existingIndex] = tx;
    } else {
        state.transactions.push(tx);
    }

    saveLocalData();
    document.getElementById('modal-transaction').classList.add('hidden');
    renderTransactions();
    updateDashboard();
}

function deleteTransaction(id) {
    if (confirm('Eliminare questa transazione?')) {
        state.transactions = state.transactions.filter(t => t.id !== id);
        saveLocalData();
        renderTransactions();
        updateDashboard();
    }
}

function editTransaction(id) {
    const tx = state.transactions.find(t => t.id === id);
    if (!tx) return;

    document.getElementById('tx-id').value = tx.id;
    document.getElementById('tx-title').value = tx.title;
    document.getElementById('tx-type').value = tx.type;
    document.getElementById('tx-amount').value = tx.amount;
    document.getElementById('tx-nature').value = tx.nature;
    document.getElementById('tx-frequency').value = tx.frequency;
    document.getElementById('tx-date').value = tx.date;
    
    populateCategorySelect();
    document.getElementById('tx-category').value = tx.categoryId;

    document.getElementById('modal-tx-title').textContent = 'Modifica Transazione';
    document.getElementById('modal-transaction').classList.remove('hidden');
}

function renderTransactions() {
    const tbody = document.getElementById('transactions-body');
    tbody.innerHTML = '';

    // Sort by date descending
    const sorted = [...state.transactions].sort((a, b) => new Date(b.date) - new Date(a.date));

    sorted.forEach(tx => {
        const cat = state.categories.find(c => c.id === tx.categoryId) || { name: 'N/D', color: '#ccc', icon: 'fa-tag' };
        const tr = document.createElement('tr');
        
        tr.innerHTML = `
            <td>${new Date(tx.date).toLocaleDateString('it-IT')}</td>
            <td><strong>${tx.title}</strong></td>
            <td><span class="badge badge-cat" style="background: ${cat.color}40; color: ${cat.color}"><i class="${cat.icon}"></i> ${cat.name}</span></td>
            <td><span class="badge ${tx.type === 'income' ? 'badge-income' : 'badge-expense'}">${tx.type === 'income' ? 'Entrata' : 'Uscita'}</span></td>
            <td><span class="badge ${tx.nature === 'preventivo' ? 'badge-prev' : 'badge-cons'}">${tx.nature === 'preventivo' ? 'Budget' : 'Consuntivo'}</span></td>
            <td>${tx.frequency === 'one-time' ? 'Una Tantum' : tx.frequency === 'monthly' ? 'Mensile' : 'Annuale'}</td>
            <td style="font-weight: bold; color: ${tx.type === 'income' ? 'var(--success)' : 'var(--danger)'}">
                ${tx.type === 'income' ? '+' : '-'}€${tx.amount.toFixed(2)}
            </td>
            <td>
                <button class="btn-icon" onclick="editTransaction('${tx.id}')"><i class="fa-solid fa-pen-to-square"></i></button>
                <button class="btn-icon" onclick="deleteTransaction('${tx.id}')" style="color: var(--danger)"><i class="fa-solid fa-trash"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Data Handling: Categories
function populateCategorySelect() {
    const select = document.getElementById('tx-category');
    select.innerHTML = '';
    state.categories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat.id;
        opt.textContent = cat.name;
        select.appendChild(opt);
    });
}

function handleCategorySubmit(e) {
    e.preventDefault();
    
    const id = document.getElementById('cat-id').value || `cat-${Date.now()}`;
    const cat = {
        id: id,
        name: document.getElementById('cat-name').value,
        color: document.getElementById('cat-color').value,
        icon: document.getElementById('cat-icon').value
    };

    const existingIndex = state.categories.findIndex(c => c.id === id);
    if (existingIndex >= 0) {
        state.categories[existingIndex] = cat;
    } else {
        state.categories.push(cat);
    }

    saveLocalData();
    document.getElementById('modal-category').classList.add('hidden');
    renderCategories();
}

function deleteCategory(id) {
    // Check if used
    if (state.transactions.some(t => t.categoryId === id)) {
        alert('Impossibile eliminare una categoria usata in una o più transazioni.');
        return;
    }

    if (confirm('Eliminare questa categoria?')) {
        state.categories = state.categories.filter(c => c.id !== id);
        saveLocalData();
        renderCategories();
    }
}

function editCategory(id) {
    const cat = state.categories.find(c => c.id === id);
    if (!cat) return;

    document.getElementById('cat-id').value = cat.id;
    document.getElementById('cat-name').value = cat.name;
    document.getElementById('cat-color').value = cat.color;
    document.getElementById('cat-icon').value = cat.icon;

    document.getElementById('modal-cat-title').textContent = 'Modifica Categoria';
    document.getElementById('modal-category').classList.remove('hidden');
}

function renderCategories() {
    const grid = document.getElementById('categories-grid');
    grid.innerHTML = '';

    state.categories.forEach(cat => {
        const div = document.createElement('div');
        div.className = 'glass-panel category-card';
        div.innerHTML = `
            <div class="cat-icon-lg" style="background: ${cat.color}">
                <i class="${cat.icon}"></i>
            </div>
            <h3>${cat.name}</h3>
            <div style="margin-top: auto; display: flex; gap: 1rem;">
                <button class="btn-icon" onclick="editCategory('${cat.id}')"><i class="fa-solid fa-pen-to-square"></i></button>
                <button class="btn-icon" onclick="deleteCategory('${cat.id}')" style="color: var(--danger)"><i class="fa-solid fa-trash"></i></button>
            </div>
        `;
        grid.appendChild(div);
    });
}

// Dashboard Calculation
function updateDashboard() {
    const period = document.getElementById('filter-period').value;
    const filterMonth = document.getElementById('filter-month').value; // YYYY-MM
    const filterYear = document.getElementById('filter-year').value; // YYYY

    let txs = state.transactions;

    // Filter by date
    if (period === 'monthly' && filterMonth) {
        txs = txs.filter(t => {
            // Include if it's matching month, or if it's a recurring monthly transaction
            // Simplification: just matching the date string prefix for now
            return t.date.startsWith(filterMonth) || (t.frequency === 'monthly' && new Date(t.date) <= new Date(filterMonth + '-31'));
        });
    } else if (period === 'annual' && filterYear) {
        txs = txs.filter(t => {
            return t.date.startsWith(filterYear) || (t.frequency === 'annual' && new Date(t.date).getFullYear() <= parseInt(filterYear)) || t.frequency === 'monthly';
        });
    }

    let incomePrev = 0, incomeCons = 0;
    let expensePrev = 0, expenseCons = 0;

    txs.forEach(t => {
        let amount = t.amount;
        
        // Basic frequency multiplication if viewing annual but tx is monthly
        if (period === 'annual' && t.frequency === 'monthly') {
            // If the transaction started this year, multiply by remaining months. Simplification: * 12
            amount = amount * 12; 
        }

        if (t.type === 'income') {
            if (t.nature === 'preventivo') incomePrev += amount;
            else incomeCons += amount;
        } else {
            if (t.nature === 'preventivo') expensePrev += amount;
            else expenseCons += amount;
        }
    });

    // Update DOM
    document.getElementById('dash-income-prev').textContent = `€ ${incomePrev.toFixed(2)}`;
    document.getElementById('dash-income-cons').textContent = `€ ${incomeCons.toFixed(2)}`;
    
    document.getElementById('dash-expense-prev').textContent = `€ ${expensePrev.toFixed(2)}`;
    document.getElementById('dash-expense-cons').textContent = `€ ${expenseCons.toFixed(2)}`;
    
    const balancePrev = incomePrev - expensePrev;
    const balanceCons = incomeCons - expenseCons;

    document.getElementById('dash-balance-prev').textContent = `€ ${balancePrev.toFixed(2)}`;
    document.getElementById('dash-balance-cons').textContent = `€ ${balanceCons.toFixed(2)}`;

    // Progress Bars
    const expensePercent = expensePrev > 0 ? Math.min((expenseCons / expensePrev) * 100, 100) : 0;
    const incomePercent = incomePrev > 0 ? Math.min((incomeCons / incomePrev) * 100, 100) : 0;

    document.getElementById('progress-expense').style.width = `${expensePercent}%`;
    document.getElementById('progress-expense-text').textContent = `${expensePercent.toFixed(1)}%`;

    document.getElementById('progress-income').style.width = `${incomePercent}%`;
    document.getElementById('progress-income-text').textContent = `${incomePercent.toFixed(1)}%`;
}
