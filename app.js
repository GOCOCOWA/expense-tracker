// ==========================================
// 1. 環境變數配置
// ==========================================
// const CLIENT_ID = '你的_GOOGLE_CLIENT_ID'; 
// const SPREADSHEET_ID = '你的_試算表_ID'; 

const CLIENT_ID = ''; // 填寫後此 API 將可用
const SPREADSHEET_ID = ''; // 填寫後此 API 將可用

const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';
let tokenClient;
let gapiInited = false;
let gisInited = false;
let categoryChartInstance = null;

// ==========================================
// 2. 初始化 Google API
// ==========================================
function gapiLoaded() { gapi.load('client', initializeGapiClient); }
async function initializeGapiClient() {
  await gapi.client.init({ discoveryDocs: ['https://sheets.googleapis.com/$discovery/rest?version=v4'] });
  gapiInited = true;
}
function gisLoaded() {
  tokenClient = google.accounts.oauth2.initTokenClient({ client_id: CLIENT_ID, scope: SCOPES, callback: '' });
  gisInited = true;
}

document.getElementById('auth-btn').onclick = () => {
  tokenClient.callback = async (resp) => {
    if (resp.error !== undefined) throw (resp);
    
    // UI 狀態更新
    document.getElementById('auth-status').innerHTML = '<span style="color: var(--primary-color); font-weight: 600;">✅ 已連線 Google 帳號</span>';
    
    const submitBtn = document.querySelector('.submit-btn');
    document.getElementById('category').disabled = false;
    document.getElementById('payment').disabled = false;
    submitBtn.innerText = '新增紀錄 (同步至雲端)';
    submitBtn.classList.add('enabled');

    await fetchFormOptions();
    await fetchDashboardData();
  };
  if (gapi.client.getToken() === null) { tokenClient.requestAccessToken({prompt: 'consent'}); } 
  else { tokenClient.requestAccessToken({prompt: ''}); }
};

window.onload = () => {
  gapiLoaded(); gisLoaded();
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('date').value = today;
  document.getElementById('month-filter').value = today.slice(0, 7);
  document.getElementById('month-filter').onchange = fetchDashboardData;
};

// ==========================================
// 3. 讀取選項
// ==========================================
async function fetchFormOptions() {
  try {
    const response = await gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID, range: '欄位表!A2:C',
    });
    const rows = response.result.values;
    if (!rows) return;

    const categories = new Set();
    const payments = new Set();
    rows.forEach(row => {
      if (row[1]) categories.add(row[1]);
      if (row[2]) payments.add(row[2]);
    });

    populateSelect('category', categories);
    populateSelect('payment', payments);
  } catch (err) { console.error('讀取欄位表失敗:', err); }
}

function populateSelect(id, setValues) {
  const select = document.getElementById(id);
  select.innerHTML = '<option value="" disabled selected>請選擇</option>'; // Reset
  setValues.forEach(val => {
    const option = document.createElement('option');
    option.value = val; option.textContent = val;
    select.appendChild(option);
  });
}

// ==========================================
// 4. 新增資料
// ==========================================
document.getElementById('expense-form').onsubmit = async (e) => {
  e.preventDefault();
  
  const id = Date.now().toString();
  const date = document.getElementById('date').value;
  const type = document.getElementById('type').value;
  const category = document.getElementById('category').value;
  const amount = document.getElementById('amount').value;
  const desc = document.getElementById('description').value;
  const payment = document.getElementById('payment').value;

  const values = [[id, date, type, category, amount, desc, payment]];

  if (gapi.client.getToken() === null) {
      alert('未連線！這只是前端展示，請點擊右上角連接 Google 帳號。');
  } else {
      try {
        await gapi.client.sheets.spreadsheets.values.append({
          spreadsheetId: SPREADSHEET_ID, range: '記帳紀錄!A:G',
          valueInputOption: 'USER_ENTERED', resource: { values: values },
        });
        alert('紀錄新增成功！');
        document.getElementById('expense-form').reset();
        document.getElementById('date').value = new Date().toISOString().split('T')[0];
        
        // 若新增的日期屬於目前篩選的月份，則重新整理畫面
        const selectedMonth = document.getElementById('month-filter').value;
        if(date.startsWith(selectedMonth)) {
            await fetchDashboardData(); 
        }
      } catch (err) {
        console.error('寫入失敗:', err);
        alert('寫入失敗，請檢查權限或試算表設定。');
      }
  }
};

// ==========================================
// 5. 抓取紀錄、產生圖表與【明細列表】
// ==========================================
async function fetchDashboardData() {
  if (gapi.client.getToken() === null) return;

  try {
    const response = await gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID, range: '記帳紀錄!A2:G',
    });
    const rows = response.result.values || [];

    const selectedMonth = document.getElementById('month-filter').value;
    let income = 0; let expense = 0;
    const expenseCategories = {};
    const monthTransactions = []; // 儲存該月的明細

    rows.forEach(row => {
      const recordDate = row[1];
      const type = row[2];
      const cat = row[3];
      const amount = parseFloat(row[4]) || 0;
      const desc = row[5] || '-';
      const payment = row[6] || '-';

      if (recordDate && recordDate.startsWith(selectedMonth)) {
        // 記錄明細
        monthTransactions.push({ date: recordDate, type, category: cat, desc, payment, amount });

        // 計算總覽與分類
        if (type === '收入') {
          income += amount;
        } else if (type === '支出') {
          expense += amount;
          expenseCategories[cat] = (expenseCategories[cat] || 0) + amount;
        }
      }
    });

    // 更新數字總覽
    document.getElementById('total-income').innerText = `NT$ ${income.toLocaleString()}`;
    document.getElementById('total-expense').innerText = `NT$ ${expense.toLocaleString()}`;
    document.getElementById('total-balance').innerText = `NT$ ${(income - expense).toLocaleString()}`;

    // 更新畫面
    renderChart(expenseCategories);
    renderTable(monthTransactions);

  } catch (err) { console.error('讀取紀錄失敗:', err); }
}

// 渲染明細表格
function renderTable(transactions) {
    const tbody = document.getElementById('transaction-list');
    tbody.innerHTML = ''; // 清空現有資料

    if (transactions.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="empty-state">該月份尚無任何交易紀錄</td></tr>`;
        return;
    }

    // 依據日期由新到舊排序
    transactions.sort((a, b) => new Date(b.date) - new Date(a.date));

    transactions.forEach(tx => {
        const tr = document.createElement('tr');
        
        // 判斷金額的顏色 class (收入顯示綠色)
        const amountClass = tx.type === '收入' ? 'type-income' : 'type-expense';
        const sign = tx.type === '收入' ? '+' : '';

        tr.innerHTML = `
            <td>${tx.date}</td>
            <td><span class="badge">${tx.category}</span></td>
            <td>${tx.desc}</td>
            <td>${tx.payment}</td>
            <td class="amount-cell ${amountClass}">${sign} NT$ ${tx.amount.toLocaleString()}</td>
        `;
        tbody.appendChild(tr);
    });
}

// 繪製支出圓餅圖
function renderChart(dataObj) {
  const ctx = document.getElementById('categoryChart').getContext('2d');
  if (categoryChartInstance) { categoryChartInstance.destroy(); }

  // 專業柔和色系 Palette
  const proColors = ['#64748B', '#94A3B8', '#CBD5E1', '#E2E8F0', '#F1F5F9'];
  const labels = Object.keys(dataObj);
  const dataValues = Object.values(dataObj);

  if (labels.length === 0) {
      // 無資料時的空圖表
      categoryChartInstance = new Chart(ctx, {
          type: 'doughnut',
          data: { labels: ['無資料'], datasets: [{ data: [1], backgroundColor: ['#F1F5F9'] }] },
          options: { responsive: true, maintainAspectRatio: false, plugins: { tooltip: { enabled: false } } }
      });
      return;
  }

  categoryChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: dataValues,
        backgroundColor: proColors.slice(0, labels.length),
        borderWidth: 1,
        borderColor: '#ffffff'
      }]
    },
    options: { 
        responsive: true, 
        maintainAspectRatio: false,
        cutout: '65%', // 讓中間的洞大一點，更具現代感
        plugins: {
            legend: { position: 'right', labels: { usePointStyle: true, boxWidth: 8, font: { size: 12 } } },
            tooltip: { callbacks: { label: (context) => ` ${context.label}: NT$ ${context.parsed.toLocaleString()}` } }
        }
    }
  });
}