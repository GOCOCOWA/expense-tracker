// --- 配置區 ---
const CLIENT_ID = '232951328539-724gscutpak4mgcgikfk1qsikbalhssm.apps.googleusercontent.com';
const SPREADSHEET_ID = '15u1XqLx0gaZiY2lgb9C44Gx9YZgZqFQxn3CXKNoLgUE';
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';

// 預設選項
const DEFAULT_OPTIONS = {
    cats: ['餐飲食品', '交通運輸', '居家生活', '休閒娛樂', '購物服飾', '醫療保健', '訂閱服務', '其他'],
    pays: ['現金', '信用卡', '簽帳卡', '電子支付', '悠遊卡']
};

let tokenClient;
let catChart = null;
let trendChart = null;

// --- 初始化 ---
function gapiLoaded() { gapi.load('client', async () => { await gapi.client.init({ discoveryDocs: ['https://sheets.googleapis.com/$discovery/rest?version=v4'] }); }); }
function gisLoaded() { tokenClient = google.accounts.oauth2.initTokenClient({ client_id: CLIENT_ID, scope: SCOPES, callback: '' }); }

window.onload = () => {
    gapiLoaded(); gisLoaded();
    const today = new Date();
    document.getElementById('date').value = today.toISOString().split('T')[0];
    document.getElementById('month-filter').value = today.toISOString().slice(0, 7);
    document.getElementById('month-filter').onchange = refreshData;
    
    // 初始化下拉選單
    populateSelect('category', DEFAULT_OPTIONS.cats);
    populateSelect('payment', DEFAULT_OPTIONS.pays);
};

// --- Google 認證與讀取 ---
document.getElementById('auth-btn').onclick = () => {
    tokenClient.callback = async (resp) => {
        if (resp.error) return;
        document.getElementById('auth-section').innerHTML = '<span class="badge">已連線試算表</span>';
        document.getElementById('submit-btn').classList.add('active');
        document.getElementById('category').disabled = false;
        document.getElementById('payment').disabled = false;
        await refreshData();
    };
    tokenClient.requestAccessToken({ prompt: gapi.client.getToken() ? '' : 'consent' });
};

async function refreshData() {
    if (!gapi.client.getToken()) return;
    try {
        const res = await gapi.client.sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: '記帳紀錄!A2:G' });
        const rows = res.result.values || [];
        const filterMonth = document.getElementById('month-filter').value;
        
        let inc = 0, exp = 0;
        const catMap = {};   // 類別比例用
        const dailyMap = {}; // 每日趨勢用
        const list = [];

        rows.forEach(r => {
            const [id, date, type, cat, amt, desc] = r;
            if (date && date.startsWith(filterMonth)) {
                const val = parseFloat(amt) || 0;
                if (type === '收入') inc += val;
                else {
                    exp += val;
                    catMap[cat] = (catMap[cat] || 0) + val;
                    // 記錄每日支出
                    const day = date.split('-')[2]; // 取得 "DD"
                    dailyMap[day] = (dailyMap[day] || 0) + val;
                }
                list.push({ date, cat, desc, val, type });
            }
        });

        document.getElementById('total-income').innerText = `NT$ ${inc.toLocaleString()}`;
        document.getElementById('total-expense').innerText = `NT$ ${exp.toLocaleString()}`;
        document.getElementById('total-balance').innerText = `NT$ ${(inc - exp).toLocaleString()}`;
        
        renderTable(list);
        renderCategoryChart(catMap);
        renderTrendChart(dailyMap);
    } catch (e) { console.error(e); }
}

// --- 圖表渲染區 ---

// 1. 類別比例 (圓餅圖)
function renderCategoryChart(data) {
    const ctx = document.getElementById('categoryChart').getContext('2d');
    if (catChart) catChart.destroy();
    catChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(data),
            datasets: [{ data: Object.values(data), backgroundColor: ['#6366f1', '#818cf8', '#a5b4fc', '#c7d2fe', '#e2e8f0'], borderWidth: 0 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } }, cutout: '70%' }
    });
}

// 2. 每日趨勢 (條狀圖) - 新增
function renderTrendChart(data) {
    const ctx = document.getElementById('trendChart').getContext('2d');
    if (trendChart) trendChart.destroy();

    // 準備 1~31 天的標籤
    const labels = Array.from({ length: 31 }, (_, i) => (i + 1).toString().padStart(2, '0'));
    const values = labels.map(day => data[day] || 0);

    trendChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: '每日支出',
                data: values,
                backgroundColor: '#818cf8',
                borderRadius: 4,
                hoverBackgroundColor: '#6366f1'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, grid: { display: false }, ticks: { font: { size: 10 } } },
                x: { grid: { display: false }, ticks: { font: { size: 9 } } }
            },
            plugins: { legend: { display: false } }
        }
    });
}

function renderTable(data) {
    const tbody = document.getElementById('transaction-list');
    tbody.innerHTML = '';
    data.sort((a,b) => new Date(b.date) - new Date(a.date)).forEach(tx => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${tx.date.slice(5)}</td>
            <td><span class="badge">${tx.cat}</span></td>
            <td>${tx.desc || '-'}</td>
            <td class="text-right ${tx.type === '收入' ? 'success' : ''}" style="font-weight:600; color:${tx.type === '收入' ? '#10b981' : 'inherit'}">
                ${tx.type === '收入' ? '+' : ''}${tx.val.toLocaleString()}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function populateSelect(id, list) {
    const el = document.getElementById(id);
    el.innerHTML = '';
    list.forEach(i => { const o = document.createElement('option'); o.value = i; o.innerText = i; el.appendChild(o); });
}

// 提交表單
document.getElementById('expense-form').onsubmit = async (e) => {
    e.preventDefault();
    if (!gapi.client.getToken()) return alert('請先連線');

    const payload = [
        Date.now().toString(),
        document.getElementById('date').value,
        document.getElementById('type').value,
        document.getElementById('category').value,
        document.getElementById('amount').value,
        document.getElementById('description').value,
        document.getElementById('payment').value
    ];

    try {
        await gapi.client.sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID, range: '記帳紀錄!A:G',
            valueInputOption: 'USER_ENTERED', resource: { values: [payload] }
        });
        alert('儲存成功！');
        document.getElementById('expense-form').reset();
        await refreshData();
    } catch (err) { alert('儲存失敗'); }
};