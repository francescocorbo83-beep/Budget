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
    lastSync: null,
    activeDashboardView: 'financial'
};

let annualChartInstance = null;

const expandedTableState = {
    voices: new Set(),
    categories: new Set(),
    groups: new Set()
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
        if (!state.activeDashboardView) {
            state.activeDashboardView = 'financial';
        }
        
        // Migrazione automatica per impostare repeatYearly: true su transazioni di budget ricorrenti esistenti
        let migrated = false;
        if (state.transactions) {
            state.transactions = state.transactions.map(tx => {
                if (tx.nature === 'preventivo' && tx.frequency !== 'one-time' && tx.repeatYearly === undefined) {
                    tx.repeatYearly = true;
                    migrated = true;
                }
                return tx;
            });
        }
        if (migrated) {
            saveLocalData();
        }
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

    const dashCatFilter = document.getElementById('filter-dash-category');
    if (dashCatFilter) {
        dashCatFilter.addEventListener('change', updateDashboard);
    }
    const dashTypeFilter = document.getElementById('filter-dash-type');
    if (dashTypeFilter) {
        dashTypeFilter.addEventListener('change', updateDashboard);
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
        populateBudgetGroupsDatalist();
        
        // Default date to today
        document.getElementById('tx-date').valueAsDate = new Date();
        
        // Reset gruppo di budget
        const budgetGroupInput = document.getElementById('tx-budget-group');
        if (budgetGroupInput) {
            budgetGroupInput.value = '';
        }
        
        // Gestione checkbox ripetizione
        const natureSelect = document.getElementById('tx-nature');
        const repeatCheck = document.getElementById('tx-repeat-yearly');
        if (repeatCheck) {
            repeatCheck.checked = natureSelect ? natureSelect.value === 'preventivo' : false;
        }
        
        document.getElementById('modal-transaction').classList.remove('hidden');
    });

    const natureSelectEl = document.getElementById('tx-nature');
    if (natureSelectEl) {
        natureSelectEl.addEventListener('change', (e) => {
            const repeatCheck = document.getElementById('tx-repeat-yearly');
            if (repeatCheck && !document.getElementById('tx-id').value) {
                repeatCheck.checked = e.target.value === 'preventivo';
            }
        });
    }

    document.getElementById('form-transaction').addEventListener('submit', handleTransactionSubmit);

    // Dashboard View Selectors
    const btnFinancial = document.getElementById('btn-view-financial');
    const btnEconomic = document.getElementById('btn-view-economic');
    
    if (btnFinancial && btnEconomic) {
        const updateViewButtons = () => {
            const isFin = (state.activeDashboardView || 'financial') === 'financial';
            btnFinancial.style.background = isFin ? 'var(--primary)' : 'transparent';
            btnFinancial.style.color = isFin ? 'white' : 'var(--text-secondary)';
            btnEconomic.style.background = isFin ? 'transparent' : 'var(--primary)';
            btnEconomic.style.color = isFin ? 'var(--text-secondary)' : 'white';
        };

        btnFinancial.addEventListener('click', () => {
            state.activeDashboardView = 'financial';
            saveLocalData();
            updateViewButtons();
            updateDashboard();
        });

        btnEconomic.addEventListener('click', () => {
            state.activeDashboardView = 'economic';
            saveLocalData();
            updateViewButtons();
            updateDashboard();
        });

        updateViewButtons();
    }

    // Budget Transfer Modals
    const btnAddTransfer = document.getElementById('btn-add-transfer');
    if (btnAddTransfer) {
        btnAddTransfer.addEventListener('click', () => {
            document.getElementById('form-transfer').reset();
            populateCategorySelect();
            document.getElementById('transfer-date').valueAsDate = new Date();
            document.getElementById('modal-transfer').classList.remove('hidden');
        });
    }

    const formTransfer = document.getElementById('form-transfer');
    if (formTransfer) {
        formTransfer.addEventListener('submit', handleTransferSubmit);
    }

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

    // Event delegation for collapsible summary table
    const tableBody = document.getElementById('dashboard-table-body');
    if (tableBody) {
        tableBody.addEventListener('click', (e) => {
            const tr = e.target.closest('tr');
            if (!tr) return;

            if (tr.classList.contains('row-metric')) {
                const voice = tr.getAttribute('data-voice');
                if (voice === 'balance') return; // Il bilancio non si espande!
                
                const isExpanded = tr.getAttribute('data-expanded') === 'true';
                if (!isExpanded) {
                    expandedTableState.voices.add(voice);
                } else {
                    expandedTableState.voices.delete(voice);
                }
                tr.setAttribute('data-expanded', !isExpanded ? 'true' : 'false');
                
                const catRows = tableBody.querySelectorAll(`.row-category[data-voice="${voice}"]`);
                const groupRows = tableBody.querySelectorAll(`.row-group[data-voice="${voice}"]`);
                const txRows = tableBody.querySelectorAll(`.row-transaction[data-voice="${voice}"]`);
                
                if (!isExpanded) {
                    catRows.forEach(row => {
                        row.classList.remove('hidden');
                        const catId = row.getAttribute('data-category');
                        const catExpanded = row.getAttribute('data-expanded') === 'true';
                        if (catExpanded) {
                            const catGroupRows = tableBody.querySelectorAll(`.row-group[data-voice="${voice}"][data-category="${catId}"]`);
                            catGroupRows.forEach(gRow => {
                                gRow.classList.remove('hidden');
                                const groupId = gRow.getAttribute('data-group');
                                const groupExpanded = gRow.getAttribute('data-expanded') === 'true';
                                if (groupExpanded) {
                                    const gTxRows = tableBody.querySelectorAll(`.row-transaction[data-voice="${voice}"][data-category="${catId}"][data-group="${groupId}"]`);
                                    gTxRows.forEach(txRow => txRow.classList.remove('hidden'));
                                }
                            });
                        }
                    });
                } else {
                    catRows.forEach(row => row.classList.add('hidden'));
                    groupRows.forEach(row => row.classList.add('hidden'));
                    txRows.forEach(row => row.classList.add('hidden'));
                }
            } 
            else if (tr.classList.contains('row-category')) {
                const voice = tr.getAttribute('data-voice');
                const category = tr.getAttribute('data-category');
                const key = `${voice}_${category}`;
                const isExpanded = tr.getAttribute('data-expanded') === 'true';
                if (!isExpanded) {
                    expandedTableState.categories.add(key);
                } else {
                    expandedTableState.categories.delete(key);
                }
                tr.setAttribute('data-expanded', !isExpanded ? 'true' : 'false');
                
                const groupRows = tableBody.querySelectorAll(`.row-group[data-voice="${voice}"][data-category="${category}"]`);
                const txRows = tableBody.querySelectorAll(`.row-transaction[data-voice="${voice}"][data-category="${category}"]`);
                
                if (!isExpanded) {
                    groupRows.forEach(row => {
                        row.classList.remove('hidden');
                        const groupId = row.getAttribute('data-group');
                        const groupExpanded = row.getAttribute('data-expanded') === 'true';
                        if (groupExpanded) {
                            const gTxRows = tableBody.querySelectorAll(`.row-transaction[data-voice="${voice}"][data-category="${category}"][data-group="${groupId}"]`);
                            gTxRows.forEach(txRow => txRow.classList.remove('hidden'));
                        }
                    });
                } else {
                    groupRows.forEach(row => row.classList.add('hidden'));
                    txRows.forEach(row => row.classList.add('hidden'));
                }
            }
            else if (tr.classList.contains('row-group')) {
                const voice = tr.getAttribute('data-voice');
                const category = tr.getAttribute('data-category');
                const group = tr.getAttribute('data-group');
                const key = `${voice}_${category}_${group}`;
                const isExpanded = tr.getAttribute('data-expanded') === 'true';
                if (!isExpanded) {
                    expandedTableState.groups.add(key);
                } else {
                    expandedTableState.groups.delete(key);
                }
                tr.setAttribute('data-expanded', !isExpanded ? 'true' : 'false');
                
                const txRows = tableBody.querySelectorAll(`.row-transaction[data-voice="${voice}"][data-category="${category}"][data-group="${group}"]`);
                
                if (!isExpanded) {
                    txRows.forEach(row => row.classList.remove('hidden'));
                } else {
                    txRows.forEach(row => row.classList.add('hidden'));
                }
            }
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
        categoryId: document.getElementById('tx-category').value,
        repeatYearly: document.getElementById('tx-repeat-yearly') ? document.getElementById('tx-repeat-yearly').checked : false,
        budgetGroup: document.getElementById('tx-budget-group') ? document.getElementById('tx-budget-group').value.trim() : ''
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

function handleTransferSubmit(e) {
    e.preventDefault();
    
    const srcCatId = document.getElementById('transfer-category-src').value;
    const dstCatId = document.getElementById('transfer-category-dst').value;
    const amount = parseFloat(document.getElementById('transfer-amount').value) || 0;
    const date = document.getElementById('transfer-date').value;
    const type = document.getElementById('transfer-type').value;

    if (srcCatId === dstCatId) {
        alert('La categoria di provenienza e quella di destinazione non possono essere identiche.');
        return;
    }

    if (amount <= 0) {
        alert('L\'importo dello spostamento deve essere maggiore di zero.');
        return;
    }

    const srcCat = state.categories.find(c => c.id === srcCatId);
    const dstCat = state.categories.find(c => c.id === dstCatId);
    
    const transferId = `transfer-${Date.now()}`;
    const timestamp = Date.now();

    // 1. Transazione di Provenienza (importo negativo)
    const txSrc = {
        id: `tx-src-${timestamp}`,
        title: `Spostamento budget per ${dstCat ? dstCat.name : 'N/D'}`,
        type: type,
        amount: -amount,
        nature: 'preventivo',
        frequency: 'one-time',
        date: date,
        categoryId: srcCatId,
        transferId: transferId
    };

    // 2. Transazione di Destinazione (importo positivo)
    const txDst = {
        id: `tx-dst-${timestamp}`,
        title: `Spostamento budget da ${srcCat ? srcCat.name : 'N/D'}`,
        type: type,
        amount: amount,
        nature: 'preventivo',
        frequency: 'one-time',
        date: date,
        categoryId: dstCatId,
        transferId: transferId
    };

    state.transactions.push(txSrc);
    state.transactions.push(txDst);

    saveLocalData();
    document.getElementById('modal-transfer').classList.add('hidden');
    renderTransactions();
    updateDashboard();
}

function deleteTransaction(id) {
    const tx = state.transactions.find(t => t.id === id);
    if (!tx) return;

    let confirmMsg = 'Eliminare questa transazione?';
    let deleteFilter = t => t.id !== id;

    if (tx.transferId) {
        confirmMsg = 'Questa transazione fa parte di uno spostamento di budget. Vuoi eliminare l\'intero spostamento?';
        deleteFilter = t => t.transferId !== tx.transferId;
    }

    if (confirm(confirmMsg)) {
        state.transactions = state.transactions.filter(deleteFilter);
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
    populateBudgetGroupsDatalist();
    document.getElementById('tx-category').value = tx.categoryId;

    // Popola il campo del gruppo di budget
    const budgetGroupInput = document.getElementById('tx-budget-group');
    if (budgetGroupInput) {
        budgetGroupInput.value = tx.budgetGroup || '';
    }

    // Popola lo stato del checkbox ripetizione
    const repeatCheck = document.getElementById('tx-repeat-yearly');
    if (repeatCheck) {
        repeatCheck.checked = !!tx.repeatYearly;
    }

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
    const sorted = filteredTxs.sort((a, b) => b.date.localeCompare(a.date));

    sorted.forEach(tx => {
        const cat = state.categories.find(c => c.id === tx.categoryId) || { name: 'N/D', color: '#ccc', icon: 'fa-tag' };
        const tr = document.createElement('tr');
        
        // Parsing indipendente dal fuso orario per la visualizzazione della data
        const [yr, mo, dy] = tx.date.split('-').map(Number);
        const formattedDate = `${String(dy).padStart(2, '0')}/${String(mo).padStart(2, '0')}/${yr}`;
        
        tr.innerHTML = `
            <td>${formattedDate}</td>
            <td><strong>${tx.title}</strong></td>
            <td><span class="badge badge-cat" style="background: ${cat.color}40; color: ${cat.color}"><i class="${cat.icon}"></i> ${cat.name}</span></td>
            <td><span class="badge ${tx.type === 'income' ? 'badge-income' : 'badge-expense'}">${tx.type === 'income' ? 'Entrata' : 'Uscita'}</span></td>
            <td>
                <span class="badge ${tx.nature === 'preventivo' ? 'badge-prev' : tx.nature === 'consuntivo' ? 'badge-cons' : 'badge-acc'}">${tx.nature === 'preventivo' ? 'Budget' : tx.nature === 'consuntivo' ? 'Consuntivo' : 'Accantonamento'}</span>
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
            <td>
                ${(() => {
                    const isPositiveEffect = tx.type === 'income' ? tx.amount >= 0 : tx.amount < 0;
                    const color = isPositiveEffect ? 'var(--success)' : 'var(--danger)';
                    const sign = isPositiveEffect ? '+' : '-';
                    return `<span style="font-weight: bold; color: ${color}">${sign}€${Math.abs(tx.amount).toFixed(2)}</span>`;
                })()}
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
    
    const dashSelect = document.getElementById('filter-dash-category');
    let currentDashFilter = 'all';
    if (dashSelect) {
        currentDashFilter = dashSelect.value || 'all';
        dashSelect.innerHTML = '<option value="all">Tutte le Categorie</option>';
    }

    const tableSelect = document.getElementById('filter-tx-category');
    let currentTableFilter = 'all';
    if (tableSelect) {
        currentTableFilter = tableSelect.value || 'all';
        tableSelect.innerHTML = '<option value="all">Tutte le Categorie</option>';
    }

    const transferSrcSelect = document.getElementById('transfer-category-src');
    const transferDstSelect = document.getElementById('transfer-category-dst');
    if (transferSrcSelect && transferDstSelect) {
        transferSrcSelect.innerHTML = '';
        transferDstSelect.innerHTML = '';
    }

    state.categories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat.id;
        opt.textContent = cat.name;
        select.appendChild(opt);
        
        if (dashSelect) {
            const dashOpt = document.createElement('option');
            dashOpt.value = cat.id;
            dashOpt.textContent = cat.name;
            dashSelect.appendChild(dashOpt);
        }

        if (tableSelect) {
            const tableOpt = document.createElement('option');
            tableOpt.value = cat.id;
            tableOpt.textContent = cat.name;
            tableSelect.appendChild(tableOpt);
        }

        if (transferSrcSelect && transferDstSelect) {
            const srcOpt = document.createElement('option');
            srcOpt.value = cat.id;
            srcOpt.textContent = cat.name;
            transferSrcSelect.appendChild(srcOpt);

            const dstOpt = document.createElement('option');
            dstOpt.value = cat.id;
            dstOpt.textContent = cat.name;
            transferDstSelect.appendChild(dstOpt);
        }
    });
    
    if (dashSelect) dashSelect.value = currentDashFilter;
    if (tableSelect) tableSelect.value = currentTableFilter;
}

function populateBudgetGroupsDatalist() {
    const datalist = document.getElementById('budget-groups-list');
    if (!datalist) return;
    
    datalist.innerHTML = '';
    
    // Raccoglie tutti i gruppi budget e titoli dei preventivi/accantonamenti
    const groups = new Set();
    state.transactions.forEach(t => {
        if (t.nature === 'preventivo' || t.nature === 'accantonamento') {
            if (t.budgetGroup && t.budgetGroup.trim() !== '') {
                groups.add(t.budgetGroup.trim());
            } else if (t.title && t.title.trim() !== '') {
                groups.add(t.title.trim());
            }
        }
    });
    
    groups.forEach(gName => {
        const option = document.createElement('option');
        option.value = gName;
        datalist.appendChild(option);
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

    populateCategorySelect();
}

function getMonthlyImpact(tx, targetYear, targetMonth, calculationMode) {
    const [txYear, txMonth] = tx.date.split('-').map(Number);
    const txAmount = parseFloat(tx.amount) || 0;

    // Determina il mode in base all'argomento o alla natura del movimento
    let mode = calculationMode;
    if (!mode) {
        if (tx.nature === 'consuntivo') {
            mode = 'cassa';
        } else {
            // Per preventivo e accantonamento di default usiamo competenza (accantonamento)
            mode = 'accantonamento';
        }
    }

    if (mode === 'accantonamento') {
        // Ignora movimenti una tantum e mensili
        if (tx.frequency === 'one-time' || tx.frequency === 'monthly') {
            if (!calculationMode) {
                return getCassaImpact();
            }
            return 0;
        }

        let p = 1;
        if (tx.frequency === 'bimonthly') p = 2;
        else if (tx.frequency === 'quarterly') p = 3;
        else if (tx.frequency === 'semiannual') p = 6;
        else if (tx.frequency === 'annual') p = 12;

        const absoluteTxMonth = txYear * 12 + txMonth;
        const absoluteStartMonth = absoluteTxMonth - (p - 1);
        const absoluteTargetMonth = targetYear * 12 + targetMonth;

        if (tx.repeatYearly) {
            if (absoluteTargetMonth >= absoluteStartMonth) {
                return txAmount / p;
            }
            return 0;
        } else {
            // Se non ripete nel futuro (repeatYearly = false), la competenza vale SOLO per il singolo ciclo di p mesi che si conclude nel mese della transazione (txMonth)
            const absoluteEndMonth = absoluteTxMonth;

            if (absoluteTargetMonth >= absoluteStartMonth && absoluteTargetMonth <= absoluteEndMonth) {
                return txAmount / p;
            }
            return 0;
        }
    }

    function getCassaImpact() {
        if (tx.nature === 'accantonamento') {
            return 0; // Gli accantonamenti non hanno flusso di cassa reale
        }

        if (tx.frequency === 'one-time') {
            if (txYear === targetYear && txMonth === targetMonth) {
                return txAmount;
            }
            return 0;
        }

        if (tx.repeatYearly) {
            if (txYear > targetYear || (txYear === targetYear && txMonth > targetMonth)) {
                return 0;
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
            // Se non ripete nel futuro (repeatYearly = false), l'impatto di cassa vale solo ed esclusivamente per il mese/anno della data della transazione
            if (txYear === targetYear && txMonth === targetMonth) {
                return txAmount;
            }
            return 0;
        }
    }

    return getCassaImpact();
}

function getTxOccurrenceDate(tx, targetYear, targetMonth) {
    const day = parseInt(tx.date.split('-')[2]);
    const tempDate = new Date(targetYear, targetMonth, 0);
    const targetDay = Math.min(day, tempDate.getDate());
    return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
}

function formatTableCellValue(val, showZeroAsHyphen = false) {
    if (Math.abs(val) < 0.005) {
        return showZeroAsHyphen ? '-' : new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(0);
    }
    return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(val);
}

function getTxValuesForMonth(t, ym, isFin, todayYear, todayMonth, todayStr) {
    let realeVal = 0;
    let budgetVal = 0;
    let forecastVal = 0;

    const getCompImpact = () => {
        return (t.frequency === 'one-time' || t.frequency === 'monthly') ?
            getMonthlyImpact(t, ym.year, ym.month, 'cassa') :
            getMonthlyImpact(t, ym.year, ym.month, 'accantonamento');
    };

    if (isFin) {
        // --- VISTA FINANZIARIA (CASSA) ---
        if (t.nature === 'preventivo') {
            budgetVal = getMonthlyImpact(t, ym.year, ym.month, 'cassa');
        }
        
        if (t.nature === 'consuntivo') {
            realeVal = getMonthlyImpact(t, ym.year, ym.month, 'cassa');
        }
        
        let includeInFore = false;
        let foreImpact = 0;
        if (ym.year < todayYear || (ym.year === todayYear && ym.month < todayMonth)) {
            if (t.nature === 'consuntivo') {
                includeInFore = true;
                foreImpact = getMonthlyImpact(t, ym.year, ym.month, 'cassa');
            }
        } else if (ym.year > todayYear || (ym.year === todayYear && ym.month > todayMonth)) {
            if (t.nature === 'preventivo') {
                includeInFore = true;
                foreImpact = getMonthlyImpact(t, ym.year, ym.month, 'cassa');
            }
        } else {
            if (t.nature === 'consuntivo' && t.date <= todayStr) {
                includeInFore = true;
                foreImpact = getMonthlyImpact(t, ym.year, ym.month, 'cassa');
            } else if (t.nature === 'preventivo') {
                const occurrenceDateStr = getTxOccurrenceDate(t, ym.year, ym.month);
                if (occurrenceDateStr > todayStr) {
                    includeInFore = true;
                    foreImpact = getMonthlyImpact(t, ym.year, ym.month, 'cassa');
                }
            }
        }
        if (includeInFore) {
            forecastVal = foreImpact;
        }
    } else {
        // --- VISTA ECONOMICA (COMPETENZA) ---
        if (t.nature === 'preventivo' || t.nature === 'accantonamento') {
            budgetVal = getCompImpact();
        }
        
        if (t.nature === 'consuntivo') {
            realeVal = getCompImpact();
        }
        
        let includeInFore = false;
        let foreImpact = 0;
        if (ym.year < todayYear || (ym.year === todayYear && ym.month < todayMonth)) {
            if (t.nature === 'consuntivo') {
                includeInFore = true;
                foreImpact = getCompImpact();
            }
        } else if (ym.year > todayYear || (ym.year === todayYear && ym.month > todayMonth)) {
            if (t.nature === 'preventivo') {
                includeInFore = true;
                foreImpact = getCompImpact();
            }
        } else {
            if (t.nature === 'consuntivo') {
                if (t.date <= todayStr) {
                    includeInFore = true;
                    foreImpact = getCompImpact();
                }
            } else if (t.nature === 'preventivo' || t.nature === 'accantonamento') {
                if (t.frequency === 'one-time' || t.frequency === 'monthly') {
                    const occurrenceDateStr = getTxOccurrenceDate(t, ym.year, ym.month);
                    if (occurrenceDateStr > todayStr) {
                        includeInFore = true;
                        foreImpact = getMonthlyImpact(t, ym.year, ym.month, 'cassa');
                    }
                } else {
                    includeInFore = true;
                    foreImpact = getMonthlyImpact(t, ym.year, ym.month, 'accantonamento');
                }
            }
        }
        if (includeInFore) {
            forecastVal = foreImpact;
        }
    }

    return { realeVal, budgetVal, forecastVal };
}

// Dashboard Calculation
function updateDashboard() {
    const period = document.getElementById('filter-period').value;
    const filterMonth = document.getElementById('filter-month').value; // YYYY-MM
    const filterYear = document.getElementById('filter-year').value; // YYYY

    let targetMonths = [];
    if (period === 'annual' && filterYear) {
        const targetYear = parseInt(filterYear);
        for (let m = 1; m <= 12; m++) {
            targetMonths.push({ year: targetYear, month: m });
        }
    } else if (period === 'monthly' && filterMonth) {
        const [targetYear, targetMonth] = filterMonth.split('-').map(Number);
        targetMonths.push({ year: targetYear, month: targetMonth });
    }

    const today = new Date();
    const todayYear = today.getFullYear();
    const todayMonth = today.getMonth() + 1;
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const todayStr = `${yyyy}-${mm}-${dd}`;

    const isFin = (state.activeDashboardView || 'financial') === 'financial';

    const tree = {
        income: { name: 'Entrate', reale: 0, forecast: 0, budget: 0, categories: {} },
        expense: { name: 'Uscite', reale: 0, forecast: 0, budget: 0, categories: {} }
    };

    function addToTree(type, cat, groupName, representativeTx, vals, groupTxs) {
        const root = tree[type];
        root.reale += vals.realeVal;
        root.forecast += vals.forecastVal;
        root.budget += vals.budgetVal;

        if (!root.categories[cat.id]) {
            root.categories[cat.id] = {
                category: cat,
                reale: 0,
                forecast: 0,
                budget: 0,
                groups: {}
            };
        }

        const catData = root.categories[cat.id];
        catData.reale += vals.realeVal;
        catData.forecast += vals.forecastVal;
        catData.budget += vals.budgetVal;

        const key = groupName;
        if (!catData.groups[key]) {
            catData.groups[key] = {
                groupName: groupName,
                reale: vals.realeVal,
                forecast: vals.forecastVal,
                budget: vals.budgetVal,
                representativeTx: representativeTx,
                transactions: groupTxs
            };
        } else {
            const gData = catData.groups[key];
            gData.reale += vals.realeVal;
            gData.forecast += vals.forecastVal;
            gData.budget += vals.budgetVal;
            gData.transactions = [...gData.transactions, ...groupTxs];
        }
    }

    const catFilter = document.getElementById('filter-dash-category')?.value || 'all';
    const typeFilter = document.getElementById('filter-dash-type')?.value || 'all';

    // Raggruppa le transazioni per categoryId e budgetGroup (o titolo se budgetGroup è vuoto)
    const groups = {};
    state.transactions.forEach(t => {
        if (catFilter !== 'all' && t.categoryId !== catFilter) return;
        if (typeFilter !== 'all' && t.type !== typeFilter) return;

        const groupName = (t.budgetGroup && t.budgetGroup.trim() !== '') ? t.budgetGroup.trim() : t.title.trim();
        const key = `${t.categoryId}_${groupName}`;
        if (!groups[key]) {
            groups[key] = {
                categoryId: t.categoryId,
                groupName: groupName,
                transactions: []
            };
        }
        groups[key].transactions.push(t);
    });

    Object.values(groups).forEach(group => {
        const cat = state.categories.find(c => c.id === group.categoryId) || { id: group.categoryId, name: 'N/D', color: '#ccc', icon: 'fa-solid fa-tag' };
        
        let groupReale = 0;
        let groupBudget = 0;
        let groupForecast = 0;

        const txsCalculated = [];

        group.transactions.forEach(t => {
            let txReale = 0;
            let txBudget = 0;
            let txForecast = 0;

            targetMonths.forEach(ym => {
                const vals = getTxValuesForMonth(t, ym, isFin, todayYear, todayMonth, todayStr);
                txReale += vals.realeVal;
                txBudget += vals.budgetVal;

                // Calcolo preciso del forecast del singolo movimento basato sul gruppo per evitare discordanze
                let hasActiveConsuntivo = false;
                group.transactions.forEach(otherT => {
                    if (otherT.nature === 'consuntivo') {
                        const otherVals = getTxValuesForMonth(otherT, ym, isFin, todayYear, todayMonth, todayStr);
                        if (Math.abs(otherVals.forecastVal) > 0.0001) {
                            hasActiveConsuntivo = true;
                        }
                    }
                });

                if (hasActiveConsuntivo) {
                    if (t.nature === 'consuntivo') {
                        txForecast += vals.forecastVal;
                    }
                } else {
                    if (t.nature !== 'consuntivo') {
                        txForecast += vals.forecastVal;
                    }
                }
            });

            groupReale += txReale;
            groupBudget += txBudget;
            groupForecast += txForecast;

            if (Math.abs(txReale) > 0.0001 || Math.abs(txBudget) > 0.0001 || Math.abs(txForecast) > 0.0001) {
                txsCalculated.push({
                    tx: t,
                    reale: txReale,
                    budget: txBudget,
                    forecast: txForecast
                });
            }
        });

        if (Math.abs(groupReale) > 0.0001 || Math.abs(groupBudget) > 0.0001 || Math.abs(groupForecast) > 0.0001) {
            const representativeTx = group.transactions.find(t => t.nature !== 'consuntivo') || group.transactions[0];
            const type = representativeTx.type;

            addToTree(type, cat, group.groupName, representativeTx, { realeVal: groupReale, budgetVal: groupBudget, forecastVal: groupForecast }, txsCalculated);
        }
    });

    const tbody = document.getElementById('dashboard-table-body');
    if (tbody) {
        let html = '';
        
        function getComparisonCells(reale, forecast, budget, type) {
            const r_b = reale - budget;
            const r_f = reale - forecast;
            const f_b = forecast - budget;

            let color_rb = 'var(--text-secondary)';
            let text_rb = formatTableCellValue(r_b);
            if (Math.abs(r_b) >= 0.005) {
                if (type === 'expense') {
                    color_rb = r_b > 0 ? 'var(--danger)' : 'var(--success)';
                    text_rb = (r_b > 0 ? '+' : '') + formatTableCellValue(r_b);
                } else {
                    color_rb = r_b > 0 ? 'var(--success)' : 'var(--danger)';
                    text_rb = (r_b > 0 ? '+' : '') + formatTableCellValue(r_b);
                }
            }

            let color_rf = 'var(--text-secondary)';
            let text_rf = formatTableCellValue(r_f);
            if (Math.abs(r_f) >= 0.005) {
                if (type === 'expense') {
                    color_rf = r_f > 0 ? 'var(--danger)' : 'var(--success)';
                    text_rf = (r_f > 0 ? '+' : '') + formatTableCellValue(r_f);
                } else {
                    color_rf = r_f > 0 ? 'var(--success)' : 'var(--danger)';
                    text_rf = (r_f > 0 ? '+' : '') + formatTableCellValue(r_f);
                }
            }

            let color_fb = 'var(--text-secondary)';
            let text_fb = formatTableCellValue(f_b);
            if (Math.abs(f_b) >= 0.005) {
                if (type === 'expense') {
                    color_fb = f_b > 0 ? 'var(--danger)' : 'var(--success)';
                    text_fb = (f_b > 0 ? '+' : '') + formatTableCellValue(f_b);
                } else {
                    color_fb = f_b > 0 ? 'var(--success)' : 'var(--danger)';
                    text_fb = (f_b > 0 ? '+' : '') + formatTableCellValue(f_b);
                }
            }

            return `
                <td style="text-align: right; font-weight: 500; color: ${color_rb};">${text_rb}</td>
                <td style="text-align: right; font-weight: 500; color: ${color_rf};">${text_rf}</td>
                <td style="text-align: right; font-weight: 500; color: ${color_fb};">${text_fb}</td>
            `;
        }

        // 1. Rendering di ENTRATE
        const inc = tree.income;
        const incVoiceExpanded = expandedTableState.voices.has('income');
        html += `
            <tr class="row-metric" data-voice="income" data-expanded="${incVoiceExpanded ? 'true' : 'false'}">
                <td style="padding-left: 1rem;">
                    <i class="fa-solid fa-chevron-right chevron-icon" style="color: var(--text-secondary);"></i>
                    <strong>${inc.name}</strong>
                </td>
                <td style="text-align: right; color: var(--success); font-weight: 600;">${formatTableCellValue(inc.reale)}</td>
                <td style="text-align: right; color: var(--success); font-weight: 600;">${formatTableCellValue(inc.forecast)}</td>
                <td style="text-align: right; color: var(--success); font-weight: 600;">${formatTableCellValue(inc.budget)}</td>
                ${getComparisonCells(inc.reale, inc.forecast, inc.budget, 'income')}
            </tr>
        `;

        const sortedIncCats = Object.keys(inc.categories).sort((a, b) => {
            return inc.categories[a].category.name.toLowerCase().localeCompare(inc.categories[b].category.name.toLowerCase());
        });

        sortedIncCats.forEach(catId => {
            const catData = inc.categories[catId];
            const cat = catData.category;
            const catExpanded = expandedTableState.categories.has(`income_${catId}`);
            const catVisible = incVoiceExpanded;

            html += `
                <tr class="row-category ${catVisible ? '' : 'hidden'}" data-voice="income" data-category="${catId}" data-expanded="${catExpanded ? 'true' : 'false'}">
                    <td class="indent-category">
                        <div class="category-name-wrapper">
                            <i class="fa-solid fa-chevron-right chevron-icon" style="font-size: 0.8rem; color: var(--text-secondary);"></i>
                            <i class="${cat.icon}" style="color: ${cat.color}; width: 16px; text-align: center;"></i>
                            <span>${cat.name}</span>
                        </div>
                    </td>
                    <td style="text-align: right; color: var(--text-primary); font-size: 0.9rem;">${formatTableCellValue(catData.reale, true)}</td>
                    <td style="text-align: right; color: var(--text-primary); font-size: 0.9rem;">${formatTableCellValue(catData.forecast, true)}</td>
                    <td style="text-align: right; color: var(--text-primary); font-size: 0.9rem;">${formatTableCellValue(catData.budget, true)}</td>
                    ${getComparisonCells(catData.reale, catData.forecast, catData.budget, 'income')}
                </tr>
            `;

            const sortedIncGroups = Object.values(catData.groups).sort((a, b) => {
                return a.groupName.toLowerCase().localeCompare(b.groupName.toLowerCase());
            });

            sortedIncGroups.forEach(gObj => {
                const groupName = gObj.groupName;
                const groupId = 'g-' + btoa(unescape(encodeURIComponent(groupName))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
                const groupExpanded = expandedTableState.groups.has(`income_${catId}_${groupId}`);
                const groupVisible = incVoiceExpanded && catExpanded;

                html += `
                    <tr class="row-group ${groupVisible ? '' : 'hidden'}" data-voice="income" data-category="${catId}" data-group="${groupId}" data-expanded="${groupExpanded ? 'true' : 'false'}">
                        <td class="indent-group">
                            <div class="group-name-wrapper">
                                <i class="fa-solid fa-chevron-right chevron-icon" style="font-size: 0.75rem; color: var(--text-secondary);"></i>
                                <span style="font-weight: 500;">${groupName}</span>
                            </div>
                        </td>
                        <td style="text-align: right; color: var(--text-primary); font-size: 0.85rem;">${formatTableCellValue(gObj.reale, true)}</td>
                        <td style="text-align: right; color: var(--text-primary); font-size: 0.85rem;">${formatTableCellValue(gObj.forecast, true)}</td>
                        <td style="text-align: right; color: var(--text-primary); font-size: 0.85rem;">${formatTableCellValue(gObj.budget, true)}</td>
                        ${getComparisonCells(gObj.reale, gObj.forecast, gObj.budget, 'income')}
                    </tr>
                `;

                const sortedIncTxs = gObj.transactions.sort((a, b) => {
                    const dateCompare = b.tx.date.localeCompare(a.tx.date);
                    if (dateCompare !== 0) return dateCompare;
                    return a.tx.title.localeCompare(b.tx.title);
                });

                const txVisible = incVoiceExpanded && catExpanded && groupExpanded;

                sortedIncTxs.forEach(tObj => {
                    const tx = tObj.tx;
                    const [yr, mo, dy] = tx.date.split('-').map(Number);
                    const formattedDate = `${String(dy).padStart(2, '0')}/${String(mo).padStart(2, '0')}/${yr}`;
                    
                    const FREQ_MAP = {
                        'one-time': 'Una Tantum',
                        'monthly': 'Mensile',
                        'bimonthly': 'Bimestrale',
                        'quarterly': 'Trimestrale',
                        'semiannual': 'Semestrale',
                        'annual': 'Annuale'
                    };

                    const NATURE_MAP = {
                        'preventivo': 'Budget',
                        'consuntivo': 'Reale',
                        'accantonamento': 'Accantonamento'
                    };

                    html += `
                        <tr class="row-transaction ${txVisible ? '' : 'hidden'}" data-voice="income" data-category="${catId}" data-group="${groupId}">
                            <td class="indent-transaction">
                                <div class="transaction-name-wrapper">
                                    <span style="color: var(--text-primary); font-weight: 400;">${tx.title}</span>
                                    <span class="tx-meta-info">${formattedDate} &bull; ${FREQ_MAP[tx.frequency] || tx.frequency} &bull; ${NATURE_MAP[tx.nature]}</span>
                                </div>
                            </td>
                            <td style="text-align: right; font-size: 0.8rem; color: var(--text-secondary);">${formatTableCellValue(tObj.reale, true)}</td>
                            <td style="text-align: right; font-size: 0.8rem; color: var(--text-secondary);">${formatTableCellValue(tObj.forecast, true)}</td>
                            <td style="text-align: right; font-size: 0.8rem; color: var(--text-secondary);">${formatTableCellValue(tObj.budget, true)}</td>
                            ${getComparisonCells(tObj.reale, tObj.forecast, tObj.budget, 'income')}
                        </tr>
                    `;
                });
            });
        });

        // 2. Rendering di USCITE
        const exp = tree.expense;
        const expVoiceExpanded = expandedTableState.voices.has('expense');

        html += `
            <tr class="row-metric" data-voice="expense" data-expanded="${expVoiceExpanded ? 'true' : 'false'}" style="border-top: 2px solid var(--panel-border);">
                <td style="padding-left: 1rem;">
                    <i class="fa-solid fa-chevron-right chevron-icon" style="color: var(--text-secondary);"></i>
                    <strong>${exp.name}</strong>
                </td>
                <td style="text-align: right; color: var(--danger); font-weight: 600;">${formatTableCellValue(exp.reale)}</td>
                <td style="text-align: right; color: var(--danger); font-weight: 600;">${formatTableCellValue(exp.forecast)}</td>
                <td style="text-align: right; color: var(--danger); font-weight: 600;">${formatTableCellValue(exp.budget)}</td>
                ${getComparisonCells(exp.reale, exp.forecast, exp.budget, 'expense')}
            </tr>
        `;

        const sortedExpCats = Object.keys(exp.categories).sort((a, b) => {
            return exp.categories[a].category.name.toLowerCase().localeCompare(exp.categories[b].category.name.toLowerCase());
        });

        sortedExpCats.forEach(catId => {
            const catData = exp.categories[catId];
            const cat = catData.category;
            const catExpanded = expandedTableState.categories.has(`expense_${catId}`);
            const catVisible = expVoiceExpanded;

            html += `
                <tr class="row-category ${catVisible ? '' : 'hidden'}" data-voice="expense" data-category="${catId}" data-expanded="${catExpanded ? 'true' : 'false'}">
                    <td class="indent-category">
                        <div class="category-name-wrapper">
                            <i class="fa-solid fa-chevron-right chevron-icon" style="font-size: 0.8rem; color: var(--text-secondary);"></i>
                            <i class="${cat.icon}" style="color: ${cat.color}; width: 16px; text-align: center;"></i>
                            <span>${cat.name}</span>
                        </div>
                    </td>
                    <td style="text-align: right; color: var(--text-primary); font-size: 0.9rem;">${formatTableCellValue(catData.reale, true)}</td>
                    <td style="text-align: right; color: var(--text-primary); font-size: 0.9rem;">${formatTableCellValue(catData.forecast, true)}</td>
                    <td style="text-align: right; color: var(--text-primary); font-size: 0.9rem;">${formatTableCellValue(catData.budget, true)}</td>
                    ${getComparisonCells(catData.reale, catData.forecast, catData.budget, 'expense')}
                </tr>
            `;

            const sortedExpGroups = Object.values(catData.groups).sort((a, b) => {
                return a.groupName.toLowerCase().localeCompare(b.groupName.toLowerCase());
            });

            sortedExpGroups.forEach(gObj => {
                const groupName = gObj.groupName;
                const groupId = 'g-' + btoa(unescape(encodeURIComponent(groupName))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
                const groupExpanded = expandedTableState.groups.has(`expense_${catId}_${groupId}`);
                const groupVisible = expVoiceExpanded && catExpanded;

                html += `
                    <tr class="row-group ${groupVisible ? '' : 'hidden'}" data-voice="expense" data-category="${catId}" data-group="${groupId}" data-expanded="${groupExpanded ? 'true' : 'false'}">
                        <td class="indent-group">
                            <div class="group-name-wrapper">
                                <i class="fa-solid fa-chevron-right chevron-icon" style="font-size: 0.75rem; color: var(--text-secondary);"></i>
                                <span style="font-weight: 500;">${groupName}</span>
                            </div>
                        </td>
                        <td style="text-align: right; color: var(--text-primary); font-size: 0.85rem;">${formatTableCellValue(gObj.reale, true)}</td>
                        <td style="text-align: right; color: var(--text-primary); font-size: 0.85rem;">${formatTableCellValue(gObj.forecast, true)}</td>
                        <td style="text-align: right; color: var(--text-primary); font-size: 0.85rem;">${formatTableCellValue(gObj.budget, true)}</td>
                        ${getComparisonCells(gObj.reale, gObj.forecast, gObj.budget, 'expense')}
                    </tr>
                `;

                const sortedExpTxs = gObj.transactions.sort((a, b) => {
                    const dateCompare = b.tx.date.localeCompare(a.tx.date);
                    if (dateCompare !== 0) return dateCompare;
                    return a.tx.title.localeCompare(b.tx.title);
                });

                const txVisible = expVoiceExpanded && catExpanded && groupExpanded;

                sortedExpTxs.forEach(tObj => {
                    const tx = tObj.tx;
                    const [yr, mo, dy] = tx.date.split('-').map(Number);
                    const formattedDate = `${String(dy).padStart(2, '0')}/${String(mo).padStart(2, '0')}/${yr}`;
                    
                    const FREQ_MAP = {
                        'one-time': 'Una Tantum',
                        'monthly': 'Mensile',
                        'bimonthly': 'Bimestrale',
                        'quarterly': 'Trimestrale',
                        'semiannual': 'Semestrale',
                        'annual': 'Annuale'
                    };

                    const NATURE_MAP = {
                        'preventivo': 'Budget',
                        'consuntivo': 'Reale',
                        'accantonamento': 'Accantonamento'
                    };

                    html += `
                        <tr class="row-transaction ${txVisible ? '' : 'hidden'}" data-voice="expense" data-category="${catId}" data-group="${groupId}">
                            <td class="indent-transaction">
                                <div class="transaction-name-wrapper">
                                    <span style="color: var(--text-primary); font-weight: 400;">${tx.title}</span>
                                    <span class="tx-meta-info">${formattedDate} &bull; ${FREQ_MAP[tx.frequency] || tx.frequency} &bull; ${NATURE_MAP[tx.nature]}</span>
                                </div>
                            </td>
                            <td style="text-align: right; font-size: 0.8rem; color: var(--text-secondary);">${formatTableCellValue(tObj.reale, true)}</td>
                            <td style="text-align: right; font-size: 0.8rem; color: var(--text-secondary);">${formatTableCellValue(tObj.forecast, true)}</td>
                            <td style="text-align: right; font-size: 0.8rem; color: var(--text-secondary);">${formatTableCellValue(tObj.budget, true)}</td>
                            ${getComparisonCells(tObj.reale, tObj.forecast, tObj.budget, 'expense')}
                        </tr>
                    `;
                });
            });
        });

        // 3. Rendering di BILANCIO
        const balReale = inc.reale - exp.reale;
        const balForecast = inc.forecast - exp.forecast;
        const balBudget = inc.budget - exp.budget;

        html += `
            <tr class="row-metric" data-voice="balance" style="border-top: 2px solid var(--panel-border); background: rgba(255, 255, 255, 0.05); cursor: default;">
                <td style="padding-left: 1rem;">
                    <i class="fa-solid fa-scale-balanced" style="margin-right: 0.5rem; width: 14px; text-align: center; color: var(--text-primary);"></i>
                    <strong>Bilancio</strong>
                </td>
                <td style="text-align: right; font-weight: 600; color: ${balReale >= 0 ? 'var(--success)' : 'var(--danger)'};">${formatTableCellValue(balReale)}</td>
                <td style="text-align: right; font-weight: 600; color: ${balForecast >= 0 ? 'var(--success)' : 'var(--danger)'};">${formatTableCellValue(balForecast)}</td>
                <td style="text-align: right; font-weight: 600; color: ${balBudget >= 0 ? 'var(--success)' : 'var(--danger)'};">${formatTableCellValue(balBudget)}</td>
                ${getComparisonCells(balReale, balForecast, balBudget, 'balance')}
            </tr>
        `;

        tbody.innerHTML = html;
    }

    // Aggiornamento Box Chiusura Stimata (Forecast cumulativo da inizio anno fino al mese selezionato)
    const closingLabelEl = document.getElementById('forecast-closing-label');
    const closingValEl = document.getElementById('forecast-closing-val');
    if (closingLabelEl && closingValEl) {
        const period = document.getElementById('filter-period')?.value || 'monthly';
        const filterMonth = document.getElementById('filter-month')?.value;
        const filterYear = document.getElementById('filter-year')?.value;
        const catFilter = document.getElementById('filter-dash-category')?.value || 'all';
        const typeFilter = document.getElementById('filter-dash-type')?.value || 'all';

        const monthNames = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];

        let cYear = todayYear;
        let cMaxMonth = 12;
        let labelText = '';

        if (period === 'annual') {
            cYear = parseInt(filterYear || todayYear);
            cMaxMonth = 12;
            labelText = `Chiusura Stimata Anno (${cYear}):`;
        } else {
            if (filterMonth) {
                const [y, m] = filterMonth.split('-').map(Number);
                cYear = y;
                cMaxMonth = m;
                if (cMaxMonth === 1) {
                    labelText = `Chiusura Stimata (Gen ${cYear}):`;
                } else if (cMaxMonth === 12) {
                    labelText = `Chiusura Stimata Anno (${cYear}):`;
                } else {
                    labelText = `Chiusura Stimata (Gen - ${monthNames[cMaxMonth - 1]} ${cYear}):`;
                }
            } else {
                labelText = `Chiusura Stimata Mese:`;
            }
        }

        let cumForecastVal = 0;
        const filteredTxs = state.transactions.filter(t => {
            if (catFilter !== 'all' && t.categoryId !== catFilter) return false;
            if (typeFilter !== 'all' && t.type !== typeFilter) return false;
            return true;
        });

        for (let m = 1; m <= cMaxMonth; m++) {
            const ym = { year: cYear, month: m };
            filteredTxs.forEach(t => {
                const vals = getTxValuesForMonth(t, ym, isFin, todayYear, todayMonth, todayStr);
                if (t.type === 'income') {
                    cumForecastVal += vals.forecastVal;
                } else {
                    cumForecastVal -= vals.forecastVal;
                }
            });
        }

        closingLabelEl.textContent = labelText;
        const formattedVal = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(cumForecastVal);
        closingValEl.textContent = (cumForecastVal > 0 ? '+' : '') + formattedVal;
        closingValEl.style.color = cumForecastVal >= 0 ? 'var(--success)' : 'var(--danger)';
    }

    updateDashboardChart();
}

let dashboardChartInstance = null;

function updateDashboardChart() {
    const canvas = document.getElementById('dashboardChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const period = document.getElementById('filter-period')?.value || 'monthly';
    const filterMonth = document.getElementById('filter-month')?.value;
    const filterYear = document.getElementById('filter-year')?.value;
    const catFilter = document.getElementById('filter-dash-category')?.value || 'all';
    const typeFilter = document.getElementById('filter-dash-type')?.value || 'all';
    const isFin = (state.activeDashboardView || 'financial') === 'financial';

    const today = new Date();
    const todayYear = today.getFullYear();
    const todayMonth = today.getMonth() + 1;
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const todayStr = `${yyyy}-${mm}-${dd}`;

    // La vista del grafico è SEMPRE annuale (12 mesi) per l'anno dell'analisi
    let targetYear = todayYear;
    if (period === 'annual' && filterYear) {
        targetYear = parseInt(filterYear);
    } else if (period === 'monthly' && filterMonth) {
        targetYear = parseInt(filterMonth.split('-')[0]);
    }

    const labels = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
    const dataIncCons = new Array(12).fill(0);
    const dataIncBudg = new Array(12).fill(0);
    const dataExpCons = new Array(12).fill(0);
    const dataExpBudg = new Array(12).fill(0);

    const filteredTxs = state.transactions.filter(t => {
        if (catFilter !== 'all' && t.categoryId !== catFilter) return false;
        if (typeFilter !== 'all' && t.type !== typeFilter) return false;
        return true;
    });

    for (let m = 1; m <= 12; m++) {
        const ym = { year: targetYear, month: m };
        filteredTxs.forEach(t => {
            const vals = getTxValuesForMonth(t, ym, isFin, todayYear, todayMonth, todayStr);
            if (t.type === 'income') {
                dataIncCons[m - 1] += vals.realeVal;
                dataIncBudg[m - 1] += vals.budgetVal;
            } else {
                // Le Uscite vanno in negativo sull'asse delle Y
                dataExpCons[m - 1] -= vals.realeVal;
                dataExpBudg[m - 1] -= vals.budgetVal;
            }
        });
    }

    let datasets = [];

    if (typeFilter === 'income') {
        datasets = [
            {
                label: 'Entrate Consuntivo',
                data: dataIncCons,
                backgroundColor: 'rgba(16, 185, 129, 0.85)',
                borderColor: '#10b981',
                borderWidth: 1,
                borderRadius: 4
            },
            {
                label: 'Entrate Budget',
                data: dataIncBudg,
                backgroundColor: 'rgba(99, 102, 241, 0.85)',
                borderColor: '#6366f1',
                borderWidth: 1,
                borderRadius: 4
            }
        ];
    } else if (typeFilter === 'expense') {
        datasets = [
            {
                label: 'Uscite Consuntivo',
                data: dataExpCons,
                backgroundColor: 'rgba(239, 68, 68, 0.85)',
                borderColor: '#ef4444',
                borderWidth: 1,
                borderRadius: 4
            },
            {
                label: 'Uscite Budget',
                data: dataExpBudg,
                backgroundColor: 'rgba(245, 158, 11, 0.85)',
                borderColor: '#f59e0b',
                borderWidth: 1,
                borderRadius: 4
            }
        ];
    } else {
        // Tutti i tipi ('all'): Entrate in positivo (+), Uscite in negativo (-)
        datasets = [
            {
                label: 'Entrate Consuntivo',
                data: dataIncCons,
                backgroundColor: 'rgba(16, 185, 129, 0.85)',
                borderColor: '#10b981',
                borderWidth: 1,
                borderRadius: 4
            },
            {
                label: 'Entrate Budget',
                data: dataIncBudg,
                backgroundColor: 'rgba(99, 102, 241, 0.85)',
                borderColor: '#6366f1',
                borderWidth: 1,
                borderRadius: 4
            },
            {
                label: 'Uscite Consuntivo',
                data: dataExpCons,
                backgroundColor: 'rgba(239, 68, 68, 0.85)',
                borderColor: '#ef4444',
                borderWidth: 1,
                borderRadius: 4
            },
            {
                label: 'Uscite Budget',
                data: dataExpBudg,
                backgroundColor: 'rgba(245, 158, 11, 0.85)',
                borderColor: '#f59e0b',
                borderWidth: 1,
                borderRadius: 4
            }
        ];
    }

    if (dashboardChartInstance) {
        dashboardChartInstance.destroy();
    }

    dashboardChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            onHover: (event, activeElements) => {
                const target = event.native ? event.native.target : (event.target || null);
                if (target) {
                    target.style.cursor = (activeElements && activeElements.length > 0) ? 'pointer' : 'default';
                }
            },
            onClick: (event, activeElements, chart) => {
                const points = chart.getElementsAtEventForMode(event.native || event, 'index', { intersect: false }, true);
                if (points && points.length > 0) {
                    const monthIndex = points[0].index; // 0 per Gen, 1 per Feb, ..., 11 per Dic
                    const selectedMonthNum = monthIndex + 1;
                    const monthStr = String(selectedMonthNum).padStart(2, '0');
                    const targetMonthValue = `${targetYear}-${monthStr}`;

                    const periodSelect = document.getElementById('filter-period');
                    const monthInput = document.getElementById('filter-month');
                    const yearContainer = document.getElementById('year-filter-container');
                    const monthContainer = document.getElementById('month-filter-container');

                    if (periodSelect && monthInput) {
                        periodSelect.value = 'monthly';
                        monthInput.value = targetMonthValue;
                        if (monthContainer) monthContainer.classList.remove('hidden');
                        if (yearContainer) yearContainer.classList.add('hidden');

                        updateDashboard();
                    }
                }
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        color: '#94a3b8',
                        usePointStyle: true,
                        padding: 15
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) label += ': ';
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
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#94a3b8' }
                },
                y: {
                    stacked: false,
                    grid: { color: 'rgba(255, 255, 255, 0.08)' },
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
