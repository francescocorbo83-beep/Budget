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

let annualChartInstance = null;

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
    if (typeof cloudState === 'string') {
        try {
            cloudState = JSON.parse(cloudState);
        } catch(e) {
            console.error('Errore parsing JSON da Drive:', e);
            return;
        }
    }
    if (cloudState && cloudState.categories) {
        // Merge offline data into cloudData to prevent data loss
        const cloudTxIds = new Set(cloudState.transactions.map(t => t.id));
        const localOnlyTxs = state.transactions.filter(t => !cloudTxIds.has(t.id));
        
        const cloudCatIds = new Set(cloudState.categories.map(c => c.id));
        const localOnlyCats = state.categories.filter(c => !cloudCatIds.has(c.id));
        
        cloudState.transactions = [...cloudState.transactions, ...localOnlyTxs];
        cloudState.categories = [...cloudState.categories, ...localOnlyCats];
        
        state = cloudState;
        localStorage.setItem('nexbudget_data', JSON.stringify(state));
        updateDashboard();
        renderTransactions();
        renderCategories();
        
        // Push merged data back to cloud if there was local-only data
        if ((localOnlyTxs.length > 0 || localOnlyCats.length > 0) && window.gdriveSyncData) {
            window.gdriveSyncData(state);
        }
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

    const chartFilter = document.getElementById('chart-category-filter');
    if (chartFilter) {
        chartFilter.addEventListener('change', updateAnnualChart);
    }

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

    // Transactions Table Filters
    const txFilters = ['filter-tx-date-start', 'filter-tx-date-end', 'filter-tx-category', 'filter-tx-type', 'filter-tx-nature', 'filter-tx-frequency'];
    txFilters.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', renderTransactions);
    });
    const titleFilter = document.getElementById('filter-tx-title');
    if (titleFilter) titleFilter.addEventListener('input', renderTransactions);
    
    const amountOp = document.getElementById('filter-tx-amount-op');
    const amount1 = document.getElementById('filter-tx-amount-1');
    const amount2 = document.getElementById('filter-tx-amount-2');
    const amountAnd = document.getElementById('filter-tx-amount-and');
    
    if (amountOp) {
        amountOp.addEventListener('change', (e) => {
            const val = e.target.value;
            if (val === 'all') {
                amount1.style.display = 'none';
                amount2.style.display = 'none';
                amountAnd.style.display = 'none';
            } else if (val === 'between') {
                amount1.style.display = 'inline-block';
                amount2.style.display = 'inline-block';
                amountAnd.style.display = 'inline-block';
            } else {
                amount1.style.display = 'inline-block';
                amount2.style.display = 'none';
                amountAnd.style.display = 'none';
            }
            renderTransactions();
        });
    }
    if (amount1) amount1.addEventListener('input', renderTransactions);
    if (amount2) amount2.addEventListener('input', renderTransactions);

    const btnResetFilters = document.getElementById('btn-reset-filters');
    if (btnResetFilters) {
        btnResetFilters.addEventListener('click', () => {
            document.getElementById('filter-tx-date-start').value = '';
            document.getElementById('filter-tx-date-end').value = '';
            document.getElementById('filter-tx-title').value = '';
            document.getElementById('filter-tx-category').value = 'all';
            document.getElementById('filter-tx-type').value = 'all';
            document.getElementById('filter-tx-nature').value = 'all';
            document.getElementById('filter-tx-frequency').value = 'all';
            document.getElementById('filter-tx-amount-op').value = 'all';
            if (amountOp) amountOp.dispatchEvent(new Event('change'));
            renderTransactions();
        });
    }

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

    // Cloud Credentials (BYOK)
    const savedKeysStr = localStorage.getItem('nexbudget_gdrive_keys');
    if (savedKeysStr) {
        try {
            const keys = JSON.parse(savedKeysStr);
            if (keys.apiKey) document.getElementById('settings-api-key').value = keys.apiKey;
            if (keys.clientId) document.getElementById('settings-client-id').value = keys.clientId;
        } catch(e) { console.error('Errore lettura chiavi cloud'); }
    }

    const formCloud = document.getElementById('form-cloud-credentials');
    if (formCloud) {
        formCloud.addEventListener('submit', (e) => {
            e.preventDefault();
            const apiKey = document.getElementById('settings-api-key').value.trim();
            const clientId = document.getElementById('settings-client-id').value.trim();
            
            if (!apiKey || !clientId) {
                alert('Entrambi i campi sono obbligatori per abilitare il Cloud.');
                return;
            }

            localStorage.setItem('nexbudget_gdrive_keys', JSON.stringify({ apiKey, clientId }));
            alert('Credenziali salvate correttamente! La pagina verrà ricaricata per avviare il motore Cloud.');
            location.reload();
        });
    }

    // Export CSV
    const exportYearInput = document.getElementById('export-csv-year');
    if (exportYearInput) {
        exportYearInput.value = new Date().getFullYear();
    }
    const btnExportCSV = document.getElementById('btn-export-csv');
    if (btnExportCSV) {
        btnExportCSV.addEventListener('click', exportYearlyDataToCSV);
    }

    // Category Details Toggles
    const toggleExp = document.getElementById('btn-toggle-expense');
    if(toggleExp) {
        toggleExp.addEventListener('click', () => {
            toggleExp.classList.toggle('open');
            document.getElementById('details-expense').classList.toggle('hidden');
        });
    }

    const toggleInc = document.getElementById('btn-toggle-income');
    if(toggleInc) {
        toggleInc.addEventListener('click', () => {
            toggleInc.classList.toggle('open');
            document.getElementById('details-income').classList.toggle('hidden');
        });
    }

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
    if (!tbody) return;
    tbody.innerHTML = '';

    // Read filters
    const dateStart = document.getElementById('filter-tx-date-start')?.value;
    const dateEnd = document.getElementById('filter-tx-date-end')?.value;
    const searchTitle = document.getElementById('filter-tx-title')?.value.toLowerCase();
    const catFilter = document.getElementById('filter-tx-category')?.value;
    const typeFilter = document.getElementById('filter-tx-type')?.value;
    const natureFilter = document.getElementById('filter-tx-nature')?.value;
    const freqFilter = document.getElementById('filter-tx-frequency')?.value;
    const amountOp = document.getElementById('filter-tx-amount-op')?.value;
    const amount1 = parseFloat(document.getElementById('filter-tx-amount-1')?.value);
    const amount2 = parseFloat(document.getElementById('filter-tx-amount-2')?.value);

    let filteredTxs = state.transactions.filter(tx => {
        // Date
        if (dateStart && tx.date < dateStart) return false;
        if (dateEnd && tx.date > dateEnd) return false;
        
        // Title
        if (searchTitle && !tx.title.toLowerCase().includes(searchTitle)) return false;
        
        // Selects
        if (catFilter && catFilter !== 'all' && tx.categoryId !== catFilter) return false;
        if (typeFilter && typeFilter !== 'all' && tx.type !== typeFilter) return false;
        if (natureFilter && natureFilter !== 'all' && tx.nature !== natureFilter) return false;
        if (freqFilter && freqFilter !== 'all' && tx.frequency !== freqFilter) return false;
        
        // Amount
        if (amountOp && amountOp !== 'all' && !isNaN(amount1)) {
            if (amountOp === 'gt' && !(tx.amount > amount1)) return false;
            if (amountOp === 'lt' && !(tx.amount < amount1)) return false;
            if (amountOp === 'eq' && !(tx.amount === amount1)) return false;
            if (amountOp === 'between' && !isNaN(amount2)) {
                const min = Math.min(amount1, amount2);
                const max = Math.max(amount1, amount2);
                if (tx.amount < min || tx.amount > max) return false;
            }
        }
        
        return true;
    });

    // Sort by date descending
    const sorted = filteredTxs.sort((a, b) => new Date(b.date) - new Date(a.date));

    sorted.forEach(tx => {
        const cat = state.categories.find(c => c.id === tx.categoryId) || { name: 'N/D', color: '#ccc', icon: 'fa-tag' };
        const tr = document.createElement('tr');
        
        tr.innerHTML = `
            <td>${new Date(tx.date).toLocaleDateString('it-IT')}</td>
            <td><strong>${tx.title}</strong></td>
            <td><span class="badge badge-cat" style="background: ${cat.color}40; color: ${cat.color}"><i class="${cat.icon}"></i> ${cat.name}</span></td>
            <td><span class="badge ${tx.type === 'income' ? 'badge-income' : 'badge-expense'}">${tx.type === 'income' ? 'Entrata' : 'Uscita'}</span></td>
            <td>
                <span class="badge ${tx.nature === 'preventivo' ? 'badge-prev' : 'badge-cons'}">${tx.nature === 'preventivo' ? 'Budget' : 'Consuntivo'}</span>
            </td>
            <td>
                ${
                    tx.frequency === 'one-time' ? 'Una Tantum' : 
                    tx.frequency === 'monthly' ? 'Mensile' : 
                    tx.frequency === 'bimonthly' ? 'Bimestrale' : 
                    tx.frequency === 'quarterly' ? 'Trimestrale' : 
                    tx.frequency === 'semiannual' ? 'Semestrale' : 
                    'Annuale'
                }
            </td>
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
    
    const chartSelect = document.getElementById('chart-category-filter');
    let currentChartFilter = 'all';
    if (chartSelect) {
        currentChartFilter = chartSelect.value || 'all';
        chartSelect.innerHTML = '<option value="all">Tutte le Categorie</option>';
    }

    const tableSelect = document.getElementById('filter-tx-category');
    let currentTableFilter = 'all';
    if (tableSelect) {
        currentTableFilter = tableSelect.value || 'all';
        tableSelect.innerHTML = '<option value="all">Tutte le Categorie</option>';
    }

    state.categories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat.id;
        opt.textContent = cat.name;
        select.appendChild(opt);
        
        if (chartSelect) {
            const chartOpt = document.createElement('option');
            chartOpt.value = cat.id;
            chartOpt.textContent = cat.name;
            chartSelect.appendChild(chartOpt);
        }

        if (tableSelect) {
            const tableOpt = document.createElement('option');
            tableOpt.value = cat.id;
            tableOpt.textContent = cat.name;
            tableSelect.appendChild(tableOpt);
        }
    });
    
    if (chartSelect) chartSelect.value = currentChartFilter;
    if (tableSelect) tableSelect.value = currentTableFilter;
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

    populateCategorySelect();
}

function getMonthlyImpact(tx, targetYear, targetMonth) {
    const txDate = new Date(tx.date);
    const txYear = txDate.getFullYear();
    const txMonth = txDate.getMonth() + 1;
    const txAmount = parseFloat(tx.amount) || 0;

    // Se è "Una Tantum", la logica è identica per preventivo e consuntivo
    if (tx.frequency === 'one-time') {
        if (txYear === targetYear && txMonth === targetMonth) {
            return txAmount;
        }
        return 0;
    }

    if (tx.nature === 'consuntivo') {
        // Logica a CASSA (Cash Basis)
        if (txYear > targetYear || (txYear === targetYear && txMonth > targetMonth)) {
            return 0; // Transazione futura
        }
        const monthDiff = (targetYear - txYear) * 12 + (targetMonth - txMonth);
        let isHit = false;
        
        if (tx.frequency === 'monthly') isHit = true;
        else if (tx.frequency === 'bimonthly') isHit = (monthDiff % 2 === 0);
        else if (tx.frequency === 'quarterly') isHit = (monthDiff % 3 === 0);
        else if (tx.frequency === 'semiannual') isHit = (monthDiff % 6 === 0);
        else if (tx.frequency === 'annual') isHit = (monthDiff % 12 === 0);
        
        return isHit ? txAmount : 0;
    } else {
        // Logica ad ACCANTONAMENTO (Accrual Basis) per il Preventivo
        let p = 1;
        if (tx.frequency === 'monthly') p = 1;
        else if (tx.frequency === 'bimonthly') p = 2;
        else if (tx.frequency === 'quarterly') p = 3;
        else if (tx.frequency === 'semiannual') p = 6;
        else if (tx.frequency === 'annual') p = 12;

        const absoluteTxMonth = txYear * 12 + txMonth;
        const absoluteStartMonth = absoluteTxMonth - (p - 1);
        const absoluteTargetMonth = targetYear * 12 + targetMonth;

        if (absoluteTargetMonth >= absoluteStartMonth) {
            return txAmount / p;
        }

        return 0;
    }
}

// Dashboard Calculation
function updateDashboard() {
    const period = document.getElementById('filter-period').value;
    const filterMonth = document.getElementById('filter-month').value; // YYYY-MM
    const filterYear = document.getElementById('filter-year').value; // YYYY

    let txs = state.transactions;

    // Filter and calculate impacts
    const filteredTxs = [];
    
    state.transactions.forEach(t => {
        let amount = 0;
        
        if (period === 'annual' && filterYear) {
            const targetYear = parseInt(filterYear);
            for (let m = 1; m <= 12; m++) {
                amount += getMonthlyImpact(t, targetYear, m);
            }
        } else if (period === 'monthly' && filterMonth) {
            const [targetYear, targetMonth] = filterMonth.split('-').map(Number);
            amount = getMonthlyImpact(t, targetYear, targetMonth);
        }

        if (amount > 0) {
            filteredTxs.push({ ...t, calculatedAmount: amount });
        }
    });

    let incomePrev = 0, incomeCons = 0;
    let expensePrev = 0, expenseCons = 0;
    
    // Oggetto per memorizzare i totali raggruppati per categoria
    const catTotals = {};

    filteredTxs.forEach(t => {
        let amount = t.calculatedAmount;


        // Inizializza l'oggetto categoria se non esiste
        if (!catTotals[t.categoryId]) {
            catTotals[t.categoryId] = {
                prev: 0,
                cons: 0,
                type: t.type
            };
        }

        if (t.type === 'income') {
            if (t.nature === 'preventivo') {
                incomePrev += amount;
                catTotals[t.categoryId].prev += amount;
            } else {
                incomeCons += amount;
                catTotals[t.categoryId].cons += amount;
            }
        } else {
            if (t.nature === 'preventivo') {
                expensePrev += amount;
                catTotals[t.categoryId].prev += amount;
            } else {
                expenseCons += amount;
                catTotals[t.categoryId].cons += amount;
            }
        }
    });

    // Generate HTML for Category Details
    const detailsExpenseDiv = document.getElementById('details-expense');
    const detailsIncomeDiv = document.getElementById('details-income');
    let expenseHtml = '';
    let incomeHtml = '';

    Object.keys(catTotals).forEach(catId => {
        const cat = state.categories.find(c => c.id === catId);
        if (!cat) return;
        
        const totals = catTotals[catId];
        if (totals.prev === 0 && totals.cons === 0) return;

        const percent = totals.prev > 0 ? (totals.cons / totals.prev) * 100 : 0;
        const width = Math.min(percent, 100);
        
        let textStyle = '';
        if (percent > 100) {
            textStyle = totals.type === 'expense' ? 'color: var(--danger); font-weight: bold;' : 'color: var(--success); font-weight: bold;';
        }

        const html = `
            <div class="cat-progress-item">
                <div class="cat-progress-header">
                    <div class="cat-progress-name">
                        <i class="${cat.icon}" style="color: ${cat.color}"></i> ${cat.name}
                    </div>
                    <div class="cat-progress-amounts" style="${textStyle}">
                        €${totals.cons.toFixed(2)} / €${totals.prev.toFixed(2)} (${percent.toFixed(1)}%)
                    </div>
                </div>
                <div class="cat-progress-bar-bg">
                    <div class="cat-progress-bar" style="width: ${width}%; background-color: ${cat.color}"></div>
                </div>
            </div>
        `;

        if (totals.type === 'expense') {
            expenseHtml += html;
        } else {
            incomeHtml += html;
        }
    });

    if (expenseHtml === '') expenseHtml = '<div style="text-align: center; color: var(--text-secondary); font-size: 0.9rem;">Nessun dato per questo periodo</div>';
    if (incomeHtml === '') incomeHtml = '<div style="text-align: center; color: var(--text-secondary); font-size: 0.9rem;">Nessun dato per questo periodo</div>';

    if (detailsExpenseDiv) detailsExpenseDiv.innerHTML = expenseHtml;
    if (detailsIncomeDiv) detailsIncomeDiv.innerHTML = incomeHtml;

    // Update DOM
    document.getElementById('dash-income-prev').textContent = `€ ${incomePrev.toFixed(2)}`;
    document.getElementById('dash-income-cons').textContent = `€ ${incomeCons.toFixed(2)}`;
    
    document.getElementById('dash-expense-prev').textContent = `€ ${expensePrev.toFixed(2)}`;
    document.getElementById('dash-expense-cons').textContent = `€ ${expenseCons.toFixed(2)}`;
    
    const balancePrev = incomePrev - expensePrev;
    const balanceCons = incomeCons - expenseCons;

    document.getElementById('dash-balance-prev').textContent = `€ ${balancePrev.toFixed(2)}`;
    document.getElementById('dash-balance-cons').textContent = `€ ${balanceCons.toFixed(2)}`;

    // Progress Bars - Allow percentages over 100%
    const expenseTruePercent = expensePrev > 0 ? (expenseCons / expensePrev) * 100 : 0;
    const incomeTruePercent = incomePrev > 0 ? (incomeCons / incomePrev) * 100 : 0;

    // Cap visual width at 100% to prevent CSS overflow
    const expenseWidth = Math.min(expenseTruePercent, 100);
    const incomeWidth = Math.min(incomeTruePercent, 100);

    document.getElementById('progress-expense').style.width = `${expenseWidth}%`;
    const expText = document.getElementById('progress-expense-text');
    expText.textContent = `${expenseTruePercent.toFixed(1)}%`;
    
    // Alert visivo per sforamento budget (rosso per uscite, verde per entrate extra)
    if (expenseTruePercent > 100) {
        expText.style.color = 'var(--danger)';
        expText.style.fontWeight = 'bold';
    } else {
        expText.style.color = '';
        expText.style.fontWeight = '';
    }

    document.getElementById('progress-income').style.width = `${incomeWidth}%`;
    const incText = document.getElementById('progress-income-text');
    incText.textContent = `${incomeTruePercent.toFixed(1)}%`;
    
    if (incomeTruePercent > 100) {
        incText.style.color = 'var(--success)';
        incText.style.fontWeight = 'bold';
    } else {
        incText.style.color = '';
        incText.style.fontWeight = '';
    }

    updateAnnualChart();
}

function updateAnnualChart() {
    const ctx = document.getElementById('annualChart');
    if (!ctx) return;

    let targetYear = document.getElementById('filter-year').value;
    const period = document.getElementById('filter-period').value;
    if (period === 'monthly') {
        targetYear = document.getElementById('filter-month').value.split('-')[0];
    }
    targetYear = parseInt(targetYear);

    const months = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
    
    // Inizializza array vuoti
    const dataIncCons = new Array(12).fill(0);
    const dataIncPrev = new Array(12).fill(0);
    const dataExpCons = new Array(12).fill(0);
    const dataExpPrev = new Array(12).fill(0);
    const dataCashflow = new Array(12).fill(0);

    let txsToAnalyze = state.transactions;
    const catFilterElement = document.getElementById('chart-category-filter');
    if (catFilterElement && catFilterElement.value !== 'all') {
        txsToAnalyze = txsToAnalyze.filter(t => t.categoryId === catFilterElement.value);
    }

    // Calcola i totali per ogni singolo mese
    txsToAnalyze.forEach(t => {
        for (let m = 1; m <= 12; m++) {
            const impact = getMonthlyImpact(t, targetYear, m);
            if (impact > 0) {
                if (t.type === 'income') {
                    if (t.nature === 'consuntivo') dataIncCons[m-1] += impact;
                    else dataIncPrev[m-1] += impact;
                } else {
                    if (t.nature === 'consuntivo') dataExpCons[m-1] += impact;
                    else dataExpPrev[m-1] += impact;
                }
            }
        }
    });

    // Calcolo Cashflow
    for (let i = 0; i < 12; i++) {
        dataCashflow[i] = dataIncCons[i] - dataExpCons[i];
        // Convertiamo le uscite in negativo per il grafico a specchio
        dataExpCons[i] = -dataExpCons[i];
        dataExpPrev[i] = -dataExpPrev[i];
    }

    if (annualChartInstance) {
        annualChartInstance.destroy();
    }

    annualChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: months,
            datasets: [
                {
                    type: 'line',
                    label: 'Cashflow Netto (Reale)',
                    data: dataCashflow,
                    borderColor: '#f59e0b',
                    backgroundColor: '#f59e0b',
                    borderWidth: 3,
                    tension: 0.4,
                    pointRadius: 4,
                    order: 0
                },
                {
                    type: 'bar',
                    label: 'Entrate Reali',
                    data: dataIncCons,
                    backgroundColor: '#10b981',
                    borderRadius: 4,
                    order: 2
                },
                {
                    type: 'bar',
                    label: 'Uscite Reali',
                    data: dataExpCons,
                    backgroundColor: '#ef4444',
                    borderRadius: 4,
                    order: 3
                },
                {
                    type: 'line',
                    label: 'Entrate Prev.',
                    data: dataIncPrev,
                    borderColor: 'rgba(16, 185, 129, 0.5)',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    borderWidth: 2,
                    borderDash: [5, 5],
                    fill: true,
                    tension: 0.3,
                    pointRadius: 0,
                    order: 1
                },
                {
                    type: 'line',
                    label: 'Uscite Prev.',
                    data: dataExpPrev,
                    borderColor: 'rgba(239, 68, 68, 0.5)',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    borderWidth: 2,
                    borderDash: [5, 5],
                    fill: true,
                    tension: 0.3,
                    pointRadius: 0,
                    order: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        color: '#94a3b8',
                        usePointStyle: true,
                        padding: 20
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                label += new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(context.parsed.y);
                            }
                            return label;
                        }
                    }
                }
            },
            scales: {
                x: {
                    stacked: false,
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)'
                    },
                    ticks: {
                        color: '#94a3b8'
                    }
                },
                y: {
                    stacked: false,
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)',
                        zeroLineColor: 'rgba(255, 255, 255, 0.2)'
                    },
                    ticks: {
                        color: '#94a3b8',
                        callback: function(value) {
                            return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0 }).format(value);
                        }
                    }
                }
            }
        }
    });
}

// Export Functionality
function exportYearlyDataToCSV() {
    const targetYearInput = document.getElementById('export-csv-year');
    if (!targetYearInput || !targetYearInput.value) {
        alert("Inserisci un anno valido.");
        return;
    }
    
    const targetYear = parseInt(targetYearInput.value);
    
    // Intestazioni
    const headers = [
        "Anno di Analisi", 
        "Mese Competenza", 
        "Data Registrazione", 
        "Titolo", 
        "Categoria", 
        "Tipo", 
        "Natura", 
        "Frequenza", 
        "Importo"
    ];
    
    const rows = [];
    rows.push(headers.join(";"));
    
    state.transactions.forEach(t => {
        const cat = state.categories.find(c => c.id === t.categoryId);
        const catName = cat ? cat.name : "N/D";
        
        // Formattazione per Excel CSV: 
        // Usiamo il punto e virgola come separatore per l'Europa
        // ed evitiamo i ritorni a capo
        const titleSafe = `"${t.title.replace(/"/g, '""').replace(/\n/g, ' ')}"`;
        const catNameSafe = `"${catName.replace(/"/g, '""')}"`;
        const typeStr = t.type === 'income' ? 'Entrata' : 'Uscita';
        const natureStr = t.nature === 'preventivo' ? 'Budget' : 'Consuntivo';
        
        for (let m = 1; m <= 12; m++) {
            const impact = getMonthlyImpact(t, targetYear, m);
            if (impact > 0) {
                const amountSign = t.type === 'income' ? impact : -impact;
                // Formatta importo con la virgola per i decimali, standard europeo
                const amountFormatted = amountSign.toFixed(2).replace('.', ',');
                
                const row = [
                    targetYear,
                    m,
                    t.date,
                    titleSafe,
                    catNameSafe,
                    typeStr,
                    natureStr,
                    t.frequency,
                    amountFormatted
                ];
                rows.push(row.join(";"));
            }
        }
    });
    
    // Aggiungiamo il BOM UTF-8 all'inizio affinché Excel legga correttamente gli accenti
    const csvContent = "\uFEFF" + rows.join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `NexBudget_Analisi_${targetYear}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
