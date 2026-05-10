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

function getHitsInYear(startDateStr, frequency, targetYear) {
    const startDate = new Date(startDateStr);
    const startYear = startDate.getFullYear();
    const startMonth = startDate.getMonth() + 1; // 1-12
    
    if (startYear > targetYear) return 0;
    
    if (frequency === 'one-time') {
        return startYear === targetYear ? 1 : 0;
    }
    
    let stepMonths = 1;
    if (frequency === 'bimonthly') stepMonths = 2;
    if (frequency === 'quarterly') stepMonths = 3;
    if (frequency === 'semiannual') stepMonths = 6;
    if (frequency === 'annual') stepMonths = 12;

    let currentYear = startYear;
    let currentMonth = startMonth;
    let hits = 0;
    
    while (currentYear <= targetYear) {
        if (currentYear === targetYear) {
            hits++;
        }
        currentMonth += stepMonths;
        if (currentMonth > 12) {
            currentYear += Math.floor((currentMonth - 1) / 12);
            currentMonth = ((currentMonth - 1) % 12) + 1;
        }
    }
    return hits;
}

function isTxInMonth(tx, targetYear, targetMonth) {
    const txDate = new Date(tx.date);
    const txYear = txDate.getFullYear();
    const txMonth = txDate.getMonth() + 1;
    
    // Non considerare transazioni future
    if (txYear > targetYear || (txYear === targetYear && txMonth > targetMonth)) {
        return false;
    }

    const monthDiff = (targetYear - txYear) * 12 + (targetMonth - txMonth);

    if (tx.frequency === 'one-time') return monthDiff === 0;
    if (tx.frequency === 'monthly') return true;
    if (tx.frequency === 'bimonthly') return monthDiff % 2 === 0;
    if (tx.frequency === 'quarterly') return monthDiff % 3 === 0;
    if (tx.frequency === 'semiannual') return monthDiff % 6 === 0;
    if (tx.frequency === 'annual') return monthDiff % 12 === 0;
    return false;
}

// Dashboard Calculation
function updateDashboard() {
    const period = document.getElementById('filter-period').value;
    const filterMonth = document.getElementById('filter-month').value; // YYYY-MM
    const filterYear = document.getElementById('filter-year').value; // YYYY

    let txs = state.transactions;

    // Filter by date
    if (period === 'monthly' && filterMonth) {
        const [targetYear, targetMonth] = filterMonth.split('-').map(Number);
        txs = txs.filter(t => isTxInMonth(t, targetYear, targetMonth));
    } else if (period === 'annual' && filterYear) {
        const targetYear = parseInt(filterYear);
        txs = txs.filter(t => {
            const txYear = new Date(t.date).getFullYear();
            if (txYear > targetYear) return false;
            if (t.frequency === 'one-time') return txYear === targetYear;
            return true; // Le periodiche iniziate quest'anno o prima le includiamo
        });
    }

    let incomePrev = 0, incomeCons = 0;
    let expensePrev = 0, expenseCons = 0;
    
    // Oggetto per memorizzare i totali raggruppati per categoria
    const catTotals = {};

    txs.forEach(t => {
        let amount = t.amount;
        
        // Moltiplichiamo l'importo per il numero di occorrenze nell'anno se la vista è annuale
        if (period === 'annual') {
            const targetYear = parseInt(filterYear);
            const hits = getHitsInYear(t.date, t.frequency, targetYear);
            amount = amount * hits;
        }

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

    // Calcola i totali per ogni singolo mese
    state.transactions.forEach(t => {
        for (let m = 1; m <= 12; m++) {
            if (isTxInMonth(t, targetYear, m)) {
                if (t.type === 'income') {
                    if (t.nature === 'consuntivo') dataIncCons[m-1] += t.amount;
                    else dataIncPrev[m-1] += t.amount;
                } else {
                    if (t.nature === 'consuntivo') dataExpCons[m-1] += t.amount;
                    else dataExpPrev[m-1] += t.amount;
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
