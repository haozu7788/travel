const STORAGE_KEY = 'my_travel_plan_v12';
const TRANSPORT_KEY = 'my_travel_plan_transports';
const IMAGES_KEY = 'my_travel_plan_images'; 
const PACKING_KEY = 'my_travel_plan_packing';
const RATES_KEY = 'my_travel_plan_rates_v13'; 
const CATEGORY_KEY = 'my_travel_plan_categories';
const PRETRIP_KEY = 'my_travel_plan_pretrip_v1';
const PRETRIP_CATEGORY_KEY = 'my_travel_plan_pretrip_categories';
const DEFAULT_CATEGORIES = ['其他', '機票', '住宿', '交通', '餐飲', '門票', '購物'];
const DEFAULT_PRETRIP_CATEGORIES = ['其他', '簽證', '保險', '通訊', '手續費', '票券'];

let itineraryData = []; 
let transportOptions = [];
let uploadedImages = []; 
let packingList = [];
let categoryOptions = [];
let preTripItems = [];
let preTripCategoryOptions = [];
let expenseTooltipTimer;
let itineraryExpenseTotal = 0;
let preTripExpenseTotal = 0;

let currencyData = createDefaultCurrencyData();

window.onload = async function() {
    initDateAndTime();
    initTransports();
    initCategories();
    initPreTripCategories();
    loadRatesFromLocalStorage(); 
    loadFromStorage();
    loadImagesFromStorage();
    loadPackingFromStorage();
    loadPreTripFromStorage();
    updateTimeline();
    setInterval(updateTimeline, 60 * 1000);
    await initGapiClient(); // 等待 Google API 初始化完成
};

function createDefaultCurrencyData() {
    return {
        baseCode: 'JPY',
        baseSymbol: '¥',
        rates: { TWD: 4.8, THB: 4.3, NZD: 90.0 }
    };
}

function formatLocalDate(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function createId() {
    return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeCurrencyData(value) {
    const fallback = createDefaultCurrencyData();
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;

    const baseCode = String(value.baseCode || fallback.baseCode).trim().toUpperCase().slice(0, 12) || fallback.baseCode;
    const baseSymbol = String(value.baseSymbol || fallback.baseSymbol).trim().slice(0, 12) || fallback.baseSymbol;
    const rates = Object.create(null);
    if (value.rates && typeof value.rates === 'object' && !Array.isArray(value.rates)) {
        Object.entries(value.rates).forEach(([rawCode, rawRate]) => {
            const code = String(rawCode).trim().toUpperCase().slice(0, 12);
            const rate = Number(rawRate);
            if (code && code !== baseCode && Number.isFinite(rate) && rate > 0) rates[code] = rate;
        });
    }
    if (Object.keys(rates).length === 0) {
        Object.entries(fallback.rates).forEach(([code, rate]) => {
            if (code !== baseCode) rates[code] = rate;
        });
    }
    return { baseCode, baseSymbol, rates };
}

function normalizeItineraryData(value) {
    if (!Array.isArray(value)) return [];
    return value.filter(item => item && typeof item === 'object' && !Array.isArray(item)).map(item => {
        const rawDate = String(item.dateRaw || '');
        const validDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
            && !Number.isNaN(new Date(`${rawDate}T00:00:00`).getTime());
        const hourNumber = Number.parseInt(item.hour, 10);
        const minuteNumber = Number.parseInt(item.min, 10);
        const cost = Number(item.cost);
        return {
            id: String(item.id || createId()),
            dateRaw: validDate ? rawDate : formatLocalDate(),
            hour: String(Number.isInteger(hourNumber) && hourNumber >= 0 && hourNumber <= 23 ? hourNumber : 0).padStart(2, '0'),
            min: String(Number.isInteger(minuteNumber) && minuteNumber >= 0 && minuteNumber <= 59 ? minuteNumber : 0).padStart(2, '0'),
            dest: String(item.dest || '-'),
            transport: String(item.transport || '-'),
            duration: String(item.duration || '-'),
            cost: Number.isFinite(cost) ? cost : 0,
            currency: String(item.currency || ''),
            category: String(item.category || '其他').trim() || '其他',
            notes: String(item.notes || '')
        };
    });
}

function normalizePackingData(value) {
    if (!Array.isArray(value)) return [];
    return value.filter(item => item && typeof item === 'object' && !Array.isArray(item))
        .map(item => ({ id: String(item.id || createId()), text: String(item.text || '').trim(), done: Boolean(item.done) }))
        .filter(item => item.text);
}

function normalizeImageData(value) {
    if (!Array.isArray(value)) return [];
    return value.filter(image => typeof image === 'string' && /^data:image\/[a-z0-9.+-]+;base64,/i.test(image));
}

function normalizePreTripData(value) {
    if (!Array.isArray(value)) return [];
    const validStatuses = new Set(['pending', 'progress', 'completed']);
    return value.filter(item => item && typeof item === 'object' && !Array.isArray(item)).map(item => {
        const rawDeadline = String(item.deadline || '');
        const validDeadline = rawDeadline === '' || (/^\d{4}-\d{2}-\d{2}$/.test(rawDeadline)
            && !Number.isNaN(new Date(`${rawDeadline}T00:00:00`).getTime()));
        const cost = Number(item.cost);
        const status = String(item.status || 'pending');
        return {
            id: String(item.id || createId()),
            title: String(item.title || '').trim(),
            category: String(item.category || '其他').trim() || '其他',
            deadline: validDeadline ? rawDeadline : '',
            cost: Number.isFinite(cost) && cost >= 0 ? cost : 0,
            currency: String(item.currency || '').trim().toUpperCase(),
            status: validStatuses.has(status) ? status : 'pending',
            notes: String(item.notes || '')
        };
    }).filter(item => item.title);
}

function initDateAndTime() {
    const today = new Date();
    document.getElementById('input_date').value = formatLocalDate(today);
    const hourSelect = document.getElementById('input_hour');
    for (let i = 0; i < 24; i++) {
        const val = String(i).padStart(2, '0');
        hourSelect.add(new Option(val, val));
    }
    hourSelect.value = "09"; 
    const minSelect = document.getElementById('input_min');
    for (let i = 0; i < 60; i += 5) {
        const val = String(i).padStart(2, '0');
        minSelect.add(new Option(val, val));
    }
}

// ==========================
// 動態匯率系統
// ==========================
function loadRatesFromLocalStorage() {
    const saved = localStorage.getItem(RATES_KEY);
    if (saved) {
        try {
            currencyData = normalizeCurrencyData(JSON.parse(saved));
        } catch(e) {
            console.warn('匯率快取損壞，已恢復預設值。', e);
            currencyData = createDefaultCurrencyData();
        }
    }
    renderCurrencyUI();
}

function updateBaseCurrencyFromUI() {
    currencyData.baseCode = document.getElementById('base_currency_code').value.trim().toUpperCase().slice(0, 12) || 'JPY';
    currencyData.baseSymbol = document.getElementById('base_currency_symbol').value.trim().slice(0, 12) || '¥';
    saveRatesToLocalStorage();
}

function saveRatesToLocalStorage() {
    localStorage.setItem(RATES_KEY, JSON.stringify(currencyData));
    populateCurrencyDropdown();
    refreshTable();
    renderPreTripItems();
}

function renderCurrencyUI() {
    const container = document.getElementById('dynamic-rates-container');
    container.innerHTML = '';
    
    for (let code in currencyData.rates) {
        const wrapper = document.createElement('label');
        wrapper.className = "flex items-center gap-1 text-slate-300 bg-slate-700 px-2 py-1 rounded shadow-inner";
        const label = document.createElement('span');
        label.className = 'font-bold text-xs';
        label.textContent = code;
        const input = document.createElement('input');
        input.type = 'number';
        input.value = currencyData.rates[code];
        input.step = '0.01';
        input.className = 'w-14 p-1 text-black rounded text-center outline-none font-bold text-sm';
        input.addEventListener('change', () => updateRate(code, input.value));
        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.className = 'text-slate-400 hover:text-red-400 ml-1 font-bold transition';
        removeButton.textContent = '✕';
        removeButton.addEventListener('click', () => removeCurrency(code));
        wrapper.append(label, input, removeButton);
        container.appendChild(wrapper);
    }
    
    document.getElementById('base_currency_code').value = currencyData.baseCode;
    document.getElementById('base_currency_symbol').value = currencyData.baseSymbol;
    populateCurrencyDropdown();
}

function updateRate(code, val) {
    currencyData.rates[code] = parseFloat(val) || 1;
    saveRatesToLocalStorage();
}

function addCurrency() {
    const code = prompt("請輸入新的幣別代碼 (例如：USD, KRW)：");
    if (code && code.trim() !== "") {
        const upperCode = code.trim().toUpperCase();
        if (!currencyData.rates[upperCode] && upperCode !== currencyData.baseCode) {
            currencyData.rates[upperCode] = 1.0;
            saveRatesToLocalStorage();
            renderCurrencyUI();
        } else if (upperCode === currencyData.baseCode) {
            alert("該幣別已經是主幣別！");
        }
    }
}

function removeCurrency(code) {
    if (confirm(`確定要移除「${code}」的匯率設定嗎？`)) {
        delete currencyData.rates[code];
        saveRatesToLocalStorage();
        renderCurrencyUI();
    }
}

function populateCurrencyDropdown() {
    const select = document.getElementById('input_currency');
    const currentVal = select.value;
    select.innerHTML = '';
    select.add(new Option(currencyData.baseCode, currencyData.baseCode));
    
    for (let code in currencyData.rates) {
        select.add(new Option(code, code));
    }
    
    if (currentVal && (currentVal === currencyData.baseCode || currencyData.rates[currentVal])) {
        select.value = currentVal;
    } else {
        select.value = currencyData.baseCode;
    }

    const preTripSelect = document.getElementById('pretrip-currency');
    if (preTripSelect) {
        const preTripValue = preTripSelect.value;
        preTripSelect.innerHTML = '';
        preTripSelect.add(new Option(currencyData.baseCode, currencyData.baseCode));
        Object.keys(currencyData.rates).forEach(code => preTripSelect.add(new Option(code, code)));
        preTripSelect.value = preTripValue && (preTripValue === currencyData.baseCode || currencyData.rates[preTripValue])
            ? preTripValue
            : currencyData.baseCode;
    }
}

function toBaseCurrency(amount, currency) {
    if (!amount) return 0;
    if (currency === currencyData.baseCode) return amount;
    if (currencyData.rates[currency]) {
        return amount * currencyData.rates[currency];
    }
    return amount; 
}

// ==========================
// 交通方式選單管理
// ==========================
function initTransports() {
    const defaultTransports = ["捷運", "公車", "開車", "火車", "高鐵", "步行", "飛機", "船"];
    const saved = localStorage.getItem(TRANSPORT_KEY);
    try {
        const parsed = saved ? JSON.parse(saved) : null;
        transportOptions = Array.isArray(parsed)
            ? [...new Set(parsed.map(item => String(item).trim()).filter(Boolean))]
            : [...defaultTransports];
    } catch (error) {
        console.warn('交通方式快取損壞，已恢復預設值。', error);
        transportOptions = [...defaultTransports];
    }
    renderTransportSelect();
}

function renderTransportSelect() {
    const select = document.getElementById('input_transport');
    const currentVal = select.value; 
    select.innerHTML = '<option value="">請選擇</option>';
    transportOptions.forEach(opt => {
        select.add(new Option(opt, opt));
    });
    if (transportOptions.includes(currentVal)) select.value = currentVal;
    else select.value = "";
}

function saveTransportOptions() {
    localStorage.setItem(TRANSPORT_KEY, JSON.stringify(transportOptions));
}

function addCustomTransport() {
    const custom = prompt("請輸入新的交通方式：");
    if (custom && custom.trim() !== "") {
        const val = custom.trim();
        ensureTransportOptionExists(val);
        document.getElementById('input_transport').value = val;
    }
}

function removeSelectedTransport() {
    const select = document.getElementById('input_transport');
    const val = select.value;
    if (!val) { alert("請先選擇一個交通方式！"); return; }
    if (confirm(`確定要刪除「${val}」選單嗎？`)) {
        transportOptions = transportOptions.filter(opt => opt !== val);
        saveTransportOptions();
        renderTransportSelect();
    }
}

function ensureTransportOptionExists(val) {
    if (!val || val === '-') return;
    if (!transportOptions.includes(val)) {
        transportOptions.push(val);
        saveTransportOptions();
        renderTransportSelect();
    }
}

// ==========================
// 花費分類選單管理
// ==========================
function initCategories() {
    const saved = localStorage.getItem(CATEGORY_KEY);
    try {
        categoryOptions = saved ? JSON.parse(saved) : [...DEFAULT_CATEGORIES];
    } catch(e) {
        categoryOptions = [...DEFAULT_CATEGORIES];
    }
    if (!Array.isArray(categoryOptions)) categoryOptions = [...DEFAULT_CATEGORIES];
    categoryOptions = [...new Set(categoryOptions.map(cat => String(cat).trim()).filter(Boolean))];
    if (!categoryOptions.includes('其他')) categoryOptions.unshift('其他');
    saveCategoryOptions();
    renderCategorySelect();
}

function renderCategorySelect(preferredValue) {
    const select = document.getElementById('input_category');
    const currentVal = preferredValue || select.value || '其他';
    select.innerHTML = '';
    categoryOptions.forEach(category => select.add(new Option(category, category)));
    select.value = categoryOptions.includes(currentVal) ? currentVal : '其他';
}

function saveCategoryOptions() {
    localStorage.setItem(CATEGORY_KEY, JSON.stringify(categoryOptions));
}

function addCustomCategory() {
    const custom = prompt('請輸入新的花費分類：');
    if (!custom || !custom.trim()) return;
    const category = custom.trim();
    if (categoryOptions.includes(category)) {
        alert('這個分類已經存在！');
        renderCategorySelect(category);
        return;
    }
    categoryOptions.push(category);
    saveCategoryOptions();
    renderCategorySelect(category);
    refreshTable();
}

function renameSelectedCategory() {
    const select = document.getElementById('input_category');
    const oldName = select.value;
    if (!oldName) return;
    if (oldName === '其他') {
        alert('「其他」是未分類項目的預設分類，不能重新命名。');
        return;
    }
    const input = prompt(`請輸入「${oldName}」的新名稱：`, oldName);
    if (!input || !input.trim()) return;
    const newName = input.trim();
    if (newName === oldName) return;
    if (categoryOptions.includes(newName)) {
        alert('這個分類名稱已經存在！');
        return;
    }
    categoryOptions = categoryOptions.map(category => category === oldName ? newName : category);
    itineraryData.forEach(item => {
        if ((item.category || '其他') === oldName) item.category = newName;
    });
    saveCategoryOptions();
    saveToStorage();
    renderCategorySelect(newName);
    refreshTable();
}

function removeSelectedCategory() {
    const select = document.getElementById('input_category');
    const category = select.value;
    if (!category) return;
    if (category === '其他') {
        alert('「其他」是未分類項目的預設分類，不能刪除。');
        return;
    }
    const usedCount = itineraryData.filter(item => (item.category || '其他') === category).length;
    const message = usedCount > 0
        ? `「${category}」目前有 ${usedCount} 筆花費。刪除後將改為「其他」，確定嗎？`
        : `確定要刪除「${category}」分類嗎？`;
    if (!confirm(message)) return;
    categoryOptions = categoryOptions.filter(option => option !== category);
    itineraryData.forEach(item => {
        if ((item.category || '其他') === category) item.category = '其他';
    });
    saveCategoryOptions();
    saveToStorage();
    renderCategorySelect('其他');
    refreshTable();
}

function syncCategoriesFromItinerary() {
    itineraryData.forEach(item => {
        const category = String(item.category || '其他').trim() || '其他';
        item.category = category;
        if (!categoryOptions.includes(category)) categoryOptions.push(category);
    });
    saveCategoryOptions();
    renderCategorySelect();
}

// ==========================
// 行前事項分類選單管理
// ==========================
function initPreTripCategories() {
    const saved = localStorage.getItem(PRETRIP_CATEGORY_KEY);
    try {
        preTripCategoryOptions = saved ? JSON.parse(saved) : [...DEFAULT_PRETRIP_CATEGORIES];
    } catch (error) {
        console.warn('行前分類快取損壞，已恢復預設值。', error);
        preTripCategoryOptions = [...DEFAULT_PRETRIP_CATEGORIES];
    }
    if (!Array.isArray(preTripCategoryOptions)) preTripCategoryOptions = [...DEFAULT_PRETRIP_CATEGORIES];
    preTripCategoryOptions = [...new Set(preTripCategoryOptions.map(category => String(category).trim()).filter(Boolean))];
    if (!preTripCategoryOptions.includes('其他')) preTripCategoryOptions.unshift('其他');
    savePreTripCategoryOptions();
    renderPreTripCategorySelect();
}

function renderPreTripCategorySelect(preferredValue) {
    const select = document.getElementById('pretrip-category');
    const currentValue = preferredValue || select.value || '其他';
    select.innerHTML = '';
    preTripCategoryOptions.forEach(category => select.add(new Option(category, category)));
    select.value = preTripCategoryOptions.includes(currentValue) ? currentValue : '其他';
}

function savePreTripCategoryOptions() {
    localStorage.setItem(PRETRIP_CATEGORY_KEY, JSON.stringify(preTripCategoryOptions));
}

function addPreTripCategory() {
    const input = prompt('請輸入新的行前支出分類：');
    if (!input || !input.trim()) return;
    const category = input.trim();
    if (preTripCategoryOptions.includes(category)) {
        alert('這個分類已經存在！');
        renderPreTripCategorySelect(category);
        return;
    }
    preTripCategoryOptions.push(category);
    savePreTripCategoryOptions();
    renderPreTripCategorySelect(category);
}

function renamePreTripCategory() {
    const select = document.getElementById('pretrip-category');
    const oldName = select.value;
    if (!oldName) return;
    if (oldName === '其他') {
        alert('「其他」是未分類項目的預設分類，不能重新命名。');
        return;
    }
    const input = prompt(`請輸入「${oldName}」的新名稱：`, oldName);
    if (!input || !input.trim()) return;
    const newName = input.trim();
    if (newName === oldName) return;
    if (preTripCategoryOptions.includes(newName)) {
        alert('這個分類名稱已經存在！');
        return;
    }
    preTripCategoryOptions = preTripCategoryOptions.map(category => category === oldName ? newName : category);
    preTripItems.forEach(item => {
        if ((item.category || '其他') === oldName) item.category = newName;
    });
    savePreTripCategoryOptions();
    savePreTripToStorage();
    renderPreTripCategorySelect(newName);
    renderPreTripItems();
}

function removePreTripCategory() {
    const select = document.getElementById('pretrip-category');
    const category = select.value;
    if (!category) return;
    if (category === '其他') {
        alert('「其他」是未分類項目的預設分類，不能刪除。');
        return;
    }
    const usedCount = preTripItems.filter(item => (item.category || '其他') === category).length;
    const message = usedCount > 0
        ? `「${category}」目前有 ${usedCount} 筆行前事項。刪除後將改為「其他」，確定嗎？`
        : `確定要刪除「${category}」分類嗎？`;
    if (!confirm(message)) return;
    preTripCategoryOptions = preTripCategoryOptions.filter(option => option !== category);
    preTripItems.forEach(item => {
        if ((item.category || '其他') === category) item.category = '其他';
    });
    savePreTripCategoryOptions();
    savePreTripToStorage();
    renderPreTripCategorySelect('其他');
    renderPreTripItems();
}

function syncPreTripCategories() {
    preTripItems.forEach(item => {
        const category = String(item.category || '其他').trim() || '其他';
        item.category = category;
        if (!preTripCategoryOptions.includes(category)) preTripCategoryOptions.push(category);
    });
    savePreTripCategoryOptions();
    renderPreTripCategorySelect();
}

// ==========================
// 圖片上傳與管理邏輯
// ==========================
function handleImageUpload(input) {
    const files = Array.from(input.files);
    if (files.length === 0) return;

    const resultsArray = new Array(files.length);
    let loadedCount = 0;

    files.forEach((file, index) => {
        const reader = new FileReader();
        reader.onload = function(e) {
            resultsArray[index] = e.target.result;
            loadedCount++;
            if (loadedCount === files.length) {
                uploadedImages = uploadedImages.concat(resultsArray);
                saveImagesToStorage();
                renderImages();
            }
        };
        reader.readAsDataURL(file);
    });
    input.value = ''; 
}

function deleteImage(index) {
    if (confirm("確定要刪除這張圖片嗎？")) {
        uploadedImages.splice(index, 1);
        saveImagesToStorage();
        renderImages();
    }
}

function renderImages() {
    const grid = document.getElementById('image-grid');
    grid.innerHTML = '';

    if (uploadedImages.length === 0) {
        grid.innerHTML = '<p class="text-slate-400 text-sm italic col-span-2 py-4 text-center no-print">目前尚無附加圖片</p>';
        return;
    }

    uploadedImages.forEach((imgBase64, index) => {
        const wrapper = document.createElement('div');
        wrapper.className = "print-img-wrapper relative border border-slate-200 rounded-lg overflow-hidden bg-slate-50 p-2 shadow-sm";
        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'no-print absolute top-3 right-3 bg-red-600 text-white w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold hover:bg-red-700 shadow transition';
        deleteButton.title = '刪除圖片';
        deleteButton.textContent = '✕';
        deleteButton.addEventListener('click', () => deleteImage(index));
        const image = document.createElement('img');
        image.src = imgBase64;
        image.className = 'w-full h-auto object-contain max-h-[500px] mx-auto rounded';
        image.alt = '行程附件';
        wrapper.append(deleteButton, image);
        grid.appendChild(wrapper);
    });
}

function saveImagesToStorage() {
    try {
        localStorage.setItem(IMAGES_KEY, JSON.stringify(uploadedImages));
    } catch(e) {
        alert("圖片體積過大，已超出瀏覽器 LocalStorage 快取上限！\n但這不影響當前列印，建議匯出 JSON 做完整備份。");
    }
}

function loadImagesFromStorage() {
    const saved = localStorage.getItem(IMAGES_KEY);
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            uploadedImages = normalizeImageData(parsed);
        } catch(e) {
            console.warn('圖片快取損壞，已忽略無效資料。', e);
            uploadedImages = [];
        }
    }
    renderImages();
}

function getCategoryStyle(cat) {
    const styles = {
        '機票': { bar: 'bg-blue-500', text: 'text-blue-600', badge: 'bg-blue-100 text-blue-800' },
        '住宿': { bar: 'bg-purple-500', text: 'text-purple-600', badge: 'bg-purple-100 text-purple-800' },
        '交通': { bar: 'bg-green-500', text: 'text-green-600', badge: 'bg-green-100 text-green-800' },
        '餐飲': { bar: 'bg-yellow-500', text: 'text-yellow-600', badge: 'bg-yellow-100 text-yellow-800' },
        '門票': { bar: 'bg-indigo-500', text: 'text-indigo-600', badge: 'bg-indigo-100 text-indigo-800' },
        '購物': { bar: 'bg-pink-500', text: 'text-pink-600', badge: 'bg-pink-100 text-pink-800' },
        '其他': { bar: 'bg-slate-500', text: 'text-slate-600', badge: 'bg-slate-100 text-slate-800' }
    };
    if (Object.prototype.hasOwnProperty.call(styles, cat)) return styles[cat];
    const customStyles = [
        { bar: 'bg-cyan-500', text: 'text-cyan-600', badge: 'bg-cyan-100 text-cyan-800' },
        { bar: 'bg-orange-500', text: 'text-orange-600', badge: 'bg-orange-100 text-orange-800' },
        { bar: 'bg-emerald-500', text: 'text-emerald-600', badge: 'bg-emerald-100 text-emerald-800' },
        { bar: 'bg-violet-500', text: 'text-violet-600', badge: 'bg-violet-100 text-violet-800' },
        { bar: 'bg-rose-500', text: 'text-rose-600', badge: 'bg-rose-100 text-rose-800' }
    ];
    const hash = [...String(cat)].reduce((sum, char) => sum + char.charCodeAt(0), 0);
    return customStyles[hash % customStyles.length];
}

function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[char]);
}

function getCategoryBadge(cat) {
    const style = getCategoryStyle(cat);
    return `<span class="px-2 py-1 text-[11px] rounded ${style.badge} tracking-widest whitespace-nowrap">${escapeHtml(cat)}</span>`;
}

// ==========================
// 核心邏輯
// ==========================
function handleFormSubmit() {
    const editId = document.getElementById('edit_id').value;
    if (editId) saveEdit(editId);
    else addItem();
}

function addItem() {
    const data = getFormData();
    if (!data) return;
    data.id = Date.now().toString() + Math.random().toString(36).substr(2, 5);
    itineraryData.push(data);
    refreshTable();
    clearForm(true);
    saveToStorage();
}

function saveEdit(id) {
    const data = getFormData();
    if (!data) return;
    data.id = id; 
    const index = itineraryData.findIndex(item => item.id === id);
    if (index !== -1) {
        itineraryData[index] = data;
        refreshTable();
        cancelEdit();
        saveToStorage();
    }
}

function deleteItem(id) {
    if(confirm("確定刪除此行程嗎？")) {
        itineraryData = itineraryData.filter(item => item.id !== id);
        refreshTable();
        if (document.getElementById('edit_id').value === id) cancelEdit();
        saveToStorage();
    }
}

function refreshTable() {
    itineraryData.forEach(item => {
        const transportVal = item.transport === '-' ? '' : item.transport;
        ensureTransportOptionExists(transportVal);
    });

    itineraryData.sort((a, b) => {
        const timeA = new Date(`${a.dateRaw}T${a.hour}:${a.min}`).getTime();
        const timeB = new Date(`${b.dateRaw}T${b.hour}:${b.min}`).getTime();
        return timeA - timeB;
    });

    const tbody = document.getElementById('itinerary-list');
    tbody.innerHTML = '';

    if (itineraryData.length === 0) {
        calculateExpenses();
        updateTimeline();
        return;
    }

    const firstDateStr = itineraryData[0].dateRaw;
    const firstDateObj = new Date(firstDateStr);
    let lastDateStr = null;

    itineraryData.forEach(item => {
        if (item.dateRaw !== lastDateStr) {
            const currentDateObj = new Date(item.dateRaw);
            const diffTime = Math.abs(currentDateObj - firstDateObj);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; 
            const weekdays = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];
            const weekday = weekdays[currentDateObj.getDay()];

            const separatorRow = document.createElement('tr');
            separatorRow.className = "day-header border-t-2 border-slate-300";
            separatorRow.innerHTML = `
                <td colspan="8" class="py-3 px-4 text-lg">
                    📅 第 ${diffDays} 天 - <span class="font-normal text-slate-600 text-base">${escapeHtml(item.dateRaw.replace(/-/g, '/'))} (${weekday})</span>
                </td>
            `;
            tbody.appendChild(separatorRow);
            lastDateStr = item.dateRaw;
        }

        const row = document.createElement('tr');
        row.id = `row-${item.id}`;
        row.className = "hover:bg-slate-50 transition-colors border-b border-slate-100";
        if(document.getElementById('edit_id').value === item.id) row.classList.add('editing-row');

        const displayCost = (parseFloat(item.cost) || 0) === 0 ? "-" : `<span class="text-[10px] text-slate-400 mr-1">${escapeHtml(item.currency || currencyData.baseCode)}</span>` + parseFloat(item.cost).toLocaleString();

        // 修正地圖 URL 編碼，將 '&' 替換成 'and' 以避免 Google Maps 誤判為多個搜尋詞
        const safeDestForMap = item.dest.replace(/&/g, 'and');
        const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(safeDestForMap)}`;
        const mapBtn = `<a href="${mapUrl}" target="_blank" class="text-blue-400 hover:text-blue-600 ml-1 no-print inline-block transform hover:scale-110 transition" title="Google Maps 導航">🗺️</a>`;

        // 修正處：備註欄位加上 break-words 確保長字串（如連結或代碼）會自動折行不會推擠表格
        row.innerHTML = `
            <td class="p-3 text-center font-black text-slate-800 text-lg font-mono">${escapeHtml(item.hour)}:${escapeHtml(item.min)}</td>
            <td class="p-3 font-bold text-slate-900 text-lg">${escapeHtml(item.dest || "-")}${mapBtn}</td>
            <td class="p-3 text-slate-500 text-sm">${escapeHtml(item.transport || "-")}</td>
            <td class="p-3 text-center text-xs font-bold text-slate-600 bg-yellow-50 rounded">${escapeHtml(item.duration || "-")}</td>
            <td class="p-3 text-right font-mono font-bold text-slate-700">${displayCost}</td>
            <td class="p-3 text-center">${getCategoryBadge(item.category || '其他')}</td>
            <td class="p-3 pl-6 text-sm text-slate-600 border-l italic break-words">${escapeHtml(item.notes || "")}</td>
            <td class="p-3 text-center no-print flex justify-center gap-2">
                <button type="button" data-action="edit" class="p-1 text-blue-500 hover:text-blue-700 font-bold">✎</button>
                <button type="button" data-action="delete" class="p-1 text-red-300 hover:text-red-500 font-bold">✕</button>
            </td>
        `;
        row.querySelector('[data-action="edit"]').addEventListener('click', () => editItem(item.id));
        row.querySelector('[data-action="delete"]').addEventListener('click', () => deleteItem(item.id));
        tbody.appendChild(row);
    });
    
    calculateExpenses();
    updateTimeline();
}

function calculateExpenses() {
    let total = 0;
    let catSum = Object.create(null);
    categoryOptions.forEach(category => catSum[category] = 0);

    itineraryData.forEach(item => {
        let val = toBaseCurrency(parseFloat(item.cost) || 0, item.currency || currencyData.baseCode);
        total += val;
        let cat = item.category || '其他';
        if(catSum[cat] === undefined) catSum[cat] = 0;
        catSum[cat] += val;
    });

    itineraryExpenseTotal = total;
    updateBudgetSummary();

    const chart = document.getElementById('expense-chart');
    const legend = document.getElementById('expense-legend');
    const tooltip = document.getElementById('expense-tooltip');
    chart.innerHTML = ''; legend.innerHTML = '';
    clearTimeout(expenseTooltipTimer);
    tooltip.classList.add('hidden');
    tooltip.innerHTML = '';
    if(total === 0) return;

    for(let cat in catSum) {
        if(catSum[cat] > 0) {
            let pct = (catSum[cat] / total * 100).toFixed(1);
            let amount = Math.round(catSum[cat]).toLocaleString();
            const style = getCategoryStyle(cat);
            const showDetail = () => {
                document.querySelectorAll('[data-expense-category]').forEach(el => {
                    const selected = el.dataset.expenseCategory === cat;
                    el.classList.toggle('ring-2', selected);
                    el.classList.toggle('ring-offset-1', selected);
                    el.classList.toggle('ring-slate-700', selected);
                    el.setAttribute('aria-pressed', selected ? 'true' : 'false');
                });
                tooltip.innerHTML = `<span class="font-black">${escapeHtml(cat)}</span><span class="mx-1.5 text-slate-500">|</span>${escapeHtml(currencyData.baseSymbol)} ${amount}<span class="mx-1.5 text-slate-500">|</span>${pct}%`;
                tooltip.classList.remove('hidden');
                clearTimeout(expenseTooltipTimer);
                expenseTooltipTimer = setTimeout(() => tooltip.classList.add('hidden'), 2500);
            };
            let bar = document.createElement('div');
            bar.className = `h-full ${style.bar} cursor-pointer hover:brightness-110 transition`;
            bar.style.width = `${pct}%`;
            bar.title = `${cat}: ${currencyData.baseSymbol} ${amount} (${pct}%)`;
            bar.dataset.expenseCategory = cat;
            bar.setAttribute('role', 'button');
            bar.setAttribute('tabindex', '0');
            bar.setAttribute('aria-label', `${cat}，分類加總 ${currencyData.baseSymbol} ${amount}，占 ${pct}%`);
            bar.setAttribute('aria-pressed', 'false');
            bar.addEventListener('click', showDetail);
            bar.addEventListener('keydown', event => {
                if(event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    showDetail();
                }
            });
            chart.appendChild(bar);
            let leg = document.createElement('div');
            leg.className = `flex items-center gap-1.5 rounded px-1 py-0.5 cursor-pointer hover:bg-slate-100 transition`;
            leg.dataset.expenseCategory = cat;
            leg.setAttribute('role', 'button');
            leg.setAttribute('tabindex', '0');
            leg.setAttribute('aria-pressed', 'false');
            leg.innerHTML = `<span class="w-3 h-3 rounded-full ${style.bar} shadow-sm"></span><span class="${style.text} tracking-widest">${escapeHtml(cat)} ${pct}%</span><span class="text-slate-700 font-mono">${escapeHtml(currencyData.baseSymbol)}${amount}</span>`;
            leg.addEventListener('click', showDetail);
            leg.addEventListener('keydown', event => {
                if(event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    showDetail();
                }
            });
            legend.appendChild(leg);
        }
    }
}

function updateBudgetSummary() {
    const symbol = currencyData.baseSymbol;
    document.getElementById('total-currency').textContent = symbol;
    document.getElementById('total-amount').textContent = Math.round(itineraryExpenseTotal + preTripExpenseTotal).toLocaleString();
    document.getElementById('itinerary-expense-summary').textContent = `${symbol} ${Math.round(itineraryExpenseTotal).toLocaleString()}`;
    document.getElementById('pretrip-expense-summary').textContent = `${symbol} ${Math.round(preTripExpenseTotal).toLocaleString()}`;
    document.getElementById('pretrip-subtotal').textContent = `${symbol} ${Math.round(preTripExpenseTotal).toLocaleString()}`;
}

function getFormData() {
    const dateVal = document.getElementById('input_date').value;
    const hourVal = document.getElementById('input_hour').value;
    const minVal = document.getElementById('input_min').value;
    const destVal = document.getElementById('input_dest').value;
    if (!dateVal || !destVal) { alert("請填寫日期與目的地！"); return null; }
    return {
        dateRaw: dateVal, hour: hourVal, min: minVal, dest: destVal,
        transport: document.getElementById('input_transport').value || "-",
        duration: document.getElementById('input_duration').value || "-",
        cost: parseFloat(document.getElementById('input_cost').value) || 0,
        currency: document.getElementById('input_currency').value || currencyData.baseCode,
        category: document.getElementById('input_category').value || "其他",
        notes: document.getElementById('input_notes').value || ""
    };
}

function editItem(id) {
    const item = itineraryData.find(d => d.id === id);
    if (!item) return;
    document.getElementById('edit_id').value = id;
    document.getElementById('input_date').value = item.dateRaw;
    document.getElementById('input_hour').value = item.hour;
    document.getElementById('input_min').value = item.min;
    document.getElementById('input_dest').value = item.dest;
    const transportVal = item.transport === '-' ? '' : item.transport;
    ensureTransportOptionExists(transportVal);
    document.getElementById('input_transport').value = transportVal;
    document.getElementById('input_duration').value = item.duration === '-' ? '' : item.duration;
    document.getElementById('input_cost').value = item.cost;
    document.getElementById('input_category').value = item.category || '其他';
    document.getElementById('input_notes').value = item.notes;

    const currencyVal = item.currency || currencyData.baseCode;
    if (!currencyData.rates[currencyVal] && currencyVal !== currencyData.baseCode) {
        currencyData.rates[currencyVal] = 1.0;
        saveRatesToLocalStorage();
        renderCurrencyUI();
    }
    document.getElementById('input_currency').value = currencyVal;

    const btnArea = document.getElementById('main-btn');
    btnArea.innerHTML = "💾 保存修改";
    btnArea.classList.replace('bg-slate-800', 'bg-orange-600');
    document.getElementById('cancel-edit-area').classList.remove('hidden');
    document.getElementById('input-area').scrollIntoView({ behavior: 'smooth' });
    refreshTable();
}

function cancelEdit() {
    document.getElementById('edit_id').value = "";
    const btnArea = document.getElementById('main-btn');
    btnArea.innerHTML = "<span>＋</span> 加入行程";
    btnArea.classList.replace('bg-orange-600', 'bg-slate-800');
    document.getElementById('cancel-edit-area').classList.add('hidden');
    clearForm(true);
    refreshTable();
}

function clearForm(keepDateTime = false) {
    document.getElementById('input_dest').value = '';
    document.getElementById('input_transport').value = '';
    document.getElementById('input_duration').value = '';
    document.getElementById('input_cost').value = '';
    document.getElementById('input_currency').value = currencyData.baseCode;
    document.getElementById('input_category').value = '其他';
    document.getElementById('input_notes').value = '';
}

// 統一存檔名稱為 v13
function saveToStorage() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(itineraryData));
    showSaveStatus();
}

function loadFromStorage() {
    const savedData = localStorage.getItem(STORAGE_KEY);
    if (savedData) {
        try {
            itineraryData = fixMissingIds(JSON.parse(savedData));
            syncCategoriesFromItinerary();
        } catch(e) {
            console.warn("行程快取損壞，已忽略無效資料。", e);
            itineraryData = [];
        }
    }
    refreshTable();
}

// ==========================
// 待辦清單邏輯
// ==========================
function loadPackingFromStorage() {
    const saved = localStorage.getItem(PACKING_KEY);
    try {
        packingList = saved ? normalizePackingData(JSON.parse(saved)) : [];
    } catch (error) {
        console.warn('待辦快取損壞，已忽略無效資料。', error);
        packingList = [];
    }
    renderPackingList();
}
function savePackingToStorage() { localStorage.setItem(PACKING_KEY, JSON.stringify(packingList)); }
function renderPackingList() {
    const ul = document.getElementById('packing-list'); ul.innerHTML = '';
    packingList.forEach(item => {
        const li = document.createElement('li');
        li.className = "flex items-center gap-2 group p-1 hover:bg-slate-50 rounded transition";
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = item.done;
        checkbox.className = 'w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500 cursor-pointer border-slate-300';
        checkbox.addEventListener('change', () => togglePacking(item.id));
        const label = document.createElement('span');
        label.className = `flex-1 cursor-pointer select-none ${item.done ? 'line-through text-slate-400' : ''}`;
        label.textContent = item.text;
        label.addEventListener('click', () => {
            checkbox.checked = !checkbox.checked;
            togglePacking(item.id);
        });
        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition no-print bg-white rounded-full w-5 h-5 flex items-center justify-center font-bold';
        deleteButton.textContent = '✕';
        deleteButton.addEventListener('click', () => deletePacking(item.id));
        li.append(checkbox, label, deleteButton);
        ul.appendChild(li);
    });
}
function addPackingItem() {
    const input = document.getElementById('packing-input');
    const text = input.value.trim();
    if (!text) return;
    packingList.push({ id: Date.now().toString(), text, done: false });
    input.value = ''; savePackingToStorage(); renderPackingList();
}
function togglePacking(id) {
    const item = packingList.find(i => i.id === id);
    if (item) { item.done = !item.done; savePackingToStorage(); renderPackingList(); }
}
function deletePacking(id) {
    packingList = packingList.filter(i => i.id !== id);
    savePackingToStorage(); renderPackingList();
}
function loadPackingTemplate() {
    if(confirm("將附加出國必備清單至目前的列表中，確定嗎？")) {
        const templates = ["護照 (效期>6個月)", "簽證/入境申請表", "當地網卡/eSIM", "萬國轉接頭", "行動電源與充電線", "常備藥品 (腸胃/感冒)", "信用卡與外幣現金", "換洗衣物與外套", "個人盥洗/防曬用品", "旅平險保單憑證"];
        templates.forEach(text => {
            if(!packingList.some(i => i.text === text)) {
                packingList.push({ id: Math.random().toString(36).substr(2, 9), text, done: false });
            }
        });
        savePackingToStorage(); renderPackingList();
    }
}

// ==========================
// 行前事項與其他支出
// ==========================
function loadPreTripFromStorage() {
    const saved = localStorage.getItem(PRETRIP_KEY);
    try {
        preTripItems = saved ? normalizePreTripData(JSON.parse(saved)) : [];
    } catch (error) {
        console.warn('行前事項快取損壞，已忽略無效資料。', error);
        preTripItems = [];
    }

    let ratesChanged = false;
    preTripItems.forEach(item => {
        if (!item.currency) item.currency = currencyData.baseCode;
        if (item.currency !== currencyData.baseCode && !currencyData.rates[item.currency]) {
            currencyData.rates[item.currency] = 1;
            ratesChanged = true;
        }
    });
    if (ratesChanged) {
        localStorage.setItem(RATES_KEY, JSON.stringify(currencyData));
        renderCurrencyUI();
    }
    syncPreTripCategories();
    renderPreTripItems();
}

function savePreTripToStorage() {
    localStorage.setItem(PRETRIP_KEY, JSON.stringify(preTripItems));
    showSaveStatus();
}

function savePreTripItem() {
    const title = document.getElementById('pretrip-title').value.trim();
    if (!title) {
        alert('請輸入行前事項名稱！');
        return;
    }
    const rawCost = document.getElementById('pretrip-cost').value;
    const cost = rawCost === '' ? 0 : Number(rawCost);
    if (!Number.isFinite(cost) || cost < 0) {
        alert('請輸入有效的非負金額！');
        return;
    }

    const editId = document.getElementById('pretrip-edit-id').value;
    const item = {
        id: editId || createId(),
        title,
        category: document.getElementById('pretrip-category').value || '其他',
        deadline: document.getElementById('pretrip-deadline').value,
        cost,
        currency: document.getElementById('pretrip-currency').value || currencyData.baseCode,
        status: document.getElementById('pretrip-status').value,
        notes: document.getElementById('pretrip-notes').value
    };

    if (editId) {
        const index = preTripItems.findIndex(existing => existing.id === editId);
        if (index !== -1) preTripItems[index] = item;
    } else {
        preTripItems.push(item);
    }
    savePreTripToStorage();
    cancelPreTripEdit(false);
    renderPreTripItems();
}

function editPreTripItem(id) {
    const item = preTripItems.find(existing => existing.id === id);
    if (!item) return;
    document.getElementById('pretrip-edit-id').value = item.id;
    document.getElementById('pretrip-title').value = item.title;
    document.getElementById('pretrip-category').value = item.category;
    document.getElementById('pretrip-deadline').value = item.deadline;
    document.getElementById('pretrip-cost').value = item.cost || '';
    document.getElementById('pretrip-currency').value = item.currency || currencyData.baseCode;
    document.getElementById('pretrip-status').value = item.status;
    document.getElementById('pretrip-notes').value = item.notes;
    document.getElementById('pretrip-submit-btn').textContent = '儲存';
    document.getElementById('pretrip-cancel-btn').classList.remove('hidden');
    document.getElementById('pretrip-title').focus();
}

function cancelPreTripEdit(render = true) {
    document.getElementById('pretrip-edit-id').value = '';
    document.getElementById('pretrip-title').value = '';
    document.getElementById('pretrip-category').value = '其他';
    document.getElementById('pretrip-deadline').value = '';
    document.getElementById('pretrip-cost').value = '';
    document.getElementById('pretrip-currency').value = currencyData.baseCode;
    document.getElementById('pretrip-status').value = 'pending';
    document.getElementById('pretrip-notes').value = '';
    document.getElementById('pretrip-submit-btn').textContent = '新增';
    document.getElementById('pretrip-cancel-btn').classList.add('hidden');
    if (render) renderPreTripItems();
}

function deletePreTripItem(id) {
    const item = preTripItems.find(existing => existing.id === id);
    if (!item || !confirm(`確定刪除「${item.title}」嗎？`)) return;
    preTripItems = preTripItems.filter(existing => existing.id !== id);
    if (document.getElementById('pretrip-edit-id').value === id) cancelPreTripEdit(false);
    savePreTripToStorage();
    renderPreTripItems();
}

function renderPreTripItems() {
    const tbody = document.getElementById('pretrip-list');
    if (!tbody) return;
    tbody.innerHTML = '';
    preTripItems.sort((a, b) => {
        if (!a.deadline && !b.deadline) return 0;
        if (!a.deadline) return 1;
        if (!b.deadline) return -1;
        return a.deadline.localeCompare(b.deadline);
    });

    preTripExpenseTotal = preTripItems.reduce((sum, item) => {
        return sum + toBaseCurrency(item.cost, item.currency || currencyData.baseCode);
    }, 0);
    updateBudgetSummary();

    if (preTripItems.length === 0) {
        const emptyRow = document.createElement('tr');
        const emptyCell = document.createElement('td');
        emptyCell.colSpan = 7;
        emptyCell.className = 'p-5 text-center text-slate-400 italic';
        emptyCell.textContent = '目前尚無行前事項或其他支出';
        emptyRow.appendChild(emptyCell);
        tbody.appendChild(emptyRow);
        return;
    }

    const statusLabels = { pending: '待處理', progress: '處理中', completed: '已完成' };
    const statusClasses = {
        pending: 'bg-slate-100 text-slate-700',
        progress: 'bg-blue-100 text-blue-700',
        completed: 'bg-green-100 text-green-700'
    };
    preTripItems.forEach(item => {
        const row = document.createElement('tr');
        row.className = 'hover:bg-amber-50 transition-colors';
        const convertedCost = toBaseCurrency(item.cost, item.currency || currencyData.baseCode);
        row.innerHTML = `
            <td class="p-3 font-bold text-slate-800">${escapeHtml(item.title)}</td>
            <td class="p-3 text-slate-600">${escapeHtml(item.category)}</td>
            <td class="p-3 text-slate-600 font-mono">${item.deadline ? escapeHtml(item.deadline.replace(/-/g, '/')) : '—'}</td>
            <td class="p-3"><span class="px-2 py-1 rounded-full text-xs font-bold ${statusClasses[item.status]}">${statusLabels[item.status]}</span></td>
            <td class="p-3 text-right font-mono"><span class="text-xs text-slate-400">${escapeHtml(item.currency || currencyData.baseCode)}</span> ${Number(item.cost).toLocaleString()}<div class="text-[10px] text-slate-400">≈ ${escapeHtml(currencyData.baseSymbol)} ${Math.round(convertedCost).toLocaleString()}</div></td>
            <td class="p-3 text-slate-600 break-words">${escapeHtml(item.notes)}</td>
            <td class="p-3 text-center no-print whitespace-nowrap"><button type="button" data-action="edit" class="p-1 text-blue-500 hover:text-blue-700 font-bold">✎</button><button type="button" data-action="delete" class="p-1 text-red-400 hover:text-red-600 font-bold">✕</button></td>
        `;
        row.querySelector('[data-action="edit"]').addEventListener('click', () => editPreTripItem(item.id));
        row.querySelector('[data-action="delete"]').addEventListener('click', () => deletePreTripItem(item.id));
        tbody.appendChild(row);
    });
}

function exportData() {
    const packageData = {
        itinerary: itineraryData,
        images: uploadedImages,
        packing: packingList,
        preTrip: preTripItems,
        preTripCategories: preTripCategoryOptions,
        rates: currencyData,
        categories: categoryOptions
    };
    const blob = new Blob([JSON.stringify(packageData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `行程備份_${formatLocalDate()}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ==========================
// ★ 終極相容讀取引擎 ★
// ==========================
function importData(input) {
    const file = input.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const parsed = JSON.parse(e.target.result);
            processImportedData(parsed);
        } catch(err) { 
            console.error("讀取失敗：", err);
            alert("檔案格式異常或不相容，無法正確載入！"); 
        }
        input.value = '';
    };
    reader.readAsText(file);
}

function processImportedData(parsedData) {
    if(!confirm("確定載入此檔案嗎？目前資料將被覆蓋。")) return;

    // 1. 處理最舊版的純陣列格式 (v1~v12)
    if (Array.isArray(parsedData)) {
        itineraryData = fixMissingIds(parsedData);
        uploadedImages = [];
        packingList = [];
        preTripItems = [];
        // ★ 關鍵修復：讀取舊版資料時，重置匯率設定為預設值 (以 TWD 為主)
        currencyData = {
            baseCode: 'TWD',
            baseSymbol: 'NT$',
            rates: {
                'JPY': 0.21,
                'THB': 0.90,
                'NZD': 19.5
            }
        };
    } 
    // 2. 處理新版物件格式 (v13+)
    else if (parsedData && typeof parsedData === 'object' && !Array.isArray(parsedData)) {
        const supportedKeys = ['itinerary', 'images', 'packing', 'preTrip', 'preTripCategories', 'rates', 'categories'];
        if (!supportedKeys.some(key => Object.prototype.hasOwnProperty.call(parsedData, key))) {
            throw new Error('備份檔缺少可識別的資料欄位');
        }
        itineraryData = fixMissingIds(parsedData.itinerary || []);
        uploadedImages = normalizeImageData(parsedData.images);
        packingList = normalizePackingData(parsedData.packing);
        preTripItems = normalizePreTripData(parsedData.preTrip);
        if (Array.isArray(parsedData.preTripCategories)) {
            preTripCategoryOptions = [...new Set(parsedData.preTripCategories.map(category => String(category).trim()).filter(Boolean))];
            if (!preTripCategoryOptions.includes('其他')) preTripCategoryOptions.unshift('其他');
        }
        if (Array.isArray(parsedData.categories)) {
            categoryOptions = [...new Set(parsedData.categories.map(cat => String(cat).trim()).filter(Boolean))];
            if (!categoryOptions.includes('其他')) categoryOptions.unshift('其他');
        }
        
        // 匯率結構防呆相容處理
        if (parsedData.rates) {
            if (parsedData.rates.baseCode) {
                // v13.2+ 正常格式
                currencyData = normalizeCurrencyData(parsedData.rates);
            } else if (parsedData.rates.base) {
                // v13.1 過渡期格式
                currencyData.baseCode = 'TWD';
                currencyData.baseSymbol = parsedData.rates.base;
                currencyData.rates = {
                    'JPY': parsedData.rates.JPY || 0.21,
                    'THB': parsedData.rates.THB || 0.90,
                    'NZD': parsedData.rates.NZD || 19.5
                };
            }
        }
    } else {
        throw new Error("無法識別的格式");
    }

    // ★ 關鍵修復：舊行程若沒有標示幣別，一律預設為 TWD，並動態補齊缺少的幣別選單
    itineraryData.forEach(item => {
        if (!item.currency) item.currency = 'TWD';
        if (item.currency !== currencyData.baseCode && !currencyData.rates[item.currency]) {
            currencyData.rates[item.currency] = 1.0; 
        }
    });
    preTripItems.forEach(item => {
        if (!item.currency) item.currency = currencyData.baseCode;
        if (item.currency !== currencyData.baseCode && !currencyData.rates[item.currency]) {
            currencyData.rates[item.currency] = 1.0;
        }
    });
    syncCategoriesFromItinerary();
    syncPreTripCategories();
    
    // 寫入快取並重新渲染畫面
    localStorage.setItem(RATES_KEY, JSON.stringify(currencyData));
    saveToStorage(); saveImagesToStorage(); savePackingToStorage(); savePreTripToStorage();
    renderCurrencyUI(); refreshTable(); renderImages(); renderPackingList(); renderPreTripItems();
}

function fixMissingIds(data) {
    return normalizeItineraryData(data);
}

function clearAllData() {
    if(confirm("確定要清空所有行程、行前事項、待辦與圖片嗎？")) { 
        itineraryData = []; 
        uploadedImages = [];
        packingList = [];
        preTripItems = [];
        refreshTable(); 
        renderImages();
        renderPackingList();
        cancelPreTripEdit(false);
        renderPreTripItems();
        saveToStorage(); 
        saveImagesToStorage();
        savePackingToStorage();
        savePreTripToStorage();
    }
}

function showSaveStatus() {
    const status = document.getElementById('save-status');
    status.style.opacity = '1'; status.classList.remove('save-toast');
    void status.offsetWidth; status.classList.add('save-toast');
}

function updateTimeline() {
    const now = new Date();
    let nextItem = null;
    let currentItem = null;
    
    for(let i=0; i<itineraryData.length; i++) {
        const item = itineraryData[i];
        const itemTime = new Date(`${item.dateRaw}T${item.hour}:${item.min}`);
        if (itemTime > now) {
            nextItem = item;
            if (i > 0 && itineraryData[i-1].dateRaw === item.dateRaw) currentItem = itineraryData[i-1];
            break;
        }
    }

    document.querySelectorAll('.current-item').forEach(el => el.classList.remove('current-item'));
    if (currentItem) {
        const row = document.getElementById(`row-${currentItem.id}`);
        if (row) row.classList.add('current-item');
    }

    const tracker = document.getElementById('live-tracker');
    if (nextItem) {
        const diffMs = new Date(`${nextItem.dateRaw}T${nextItem.hour}:${nextItem.min}`) - now;
        const hrs = Math.floor(diffMs / 3600000); const mins = Math.floor((diffMs % 3600000) / 60000);
        if (hrs < 24) {
            tracker.innerHTML = `📍 距離下一個行程「<span class="underline underline-offset-4">${escapeHtml(nextItem.dest)}</span>」還有 <span class="text-xl mx-1">${hrs > 0 ? hrs + ' 小時 ' : ''}${mins} 分鐘</span>`;
            tracker.classList.remove('-translate-y-full'); tracker.classList.add('translate-y-0');
            return;
        }
    }
    tracker.classList.add('-translate-y-full'); tracker.classList.remove('translate-y-0');
}

function generatePDF() {
    window.print();
}

// ==========================
// Google Drive Integration
// ==========================
// ❗ 重要：請從 Google Cloud Console 取得您自己的 API 金鑰與用戶端 ID
// 參考說明：https://developers.google.com/drive/api/quickstart/js
const DISCOVERY_DOCS = ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"];
const SCOPES = 'https://www.googleapis.com/auth/drive.file';

let tokenClient;
let gapiInited = false;
let gisInited = false;

async function initGapiClient() {
    // 使用 Promise 來確保兩個 API 都已載入
    const gapiPromise = new Promise((resolve, reject) => {
        gapi.load('client', async () => {
            try {
                await gapi.client.init({
                    apiKey: GOOGLE_API_CONFIG.API_KEY,
                    discoveryDocs: DISCOVERY_DOCS,
                });
                gapiInited = true;
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    });

    const gisPromise = new Promise((resolve) => {
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: GOOGLE_API_CONFIG.CLIENT_ID,
            scope: SCOPES,
            callback: (tokenResponse) => {
                if (tokenResponse && tokenResponse.access_token) {
                    updateGdriveUI(true);
                }
            },
        });
        gisInited = true;
        resolve();
    });

    try {
        // 等待兩個 Promise 都完成後，才啟用登入按鈕
        await Promise.all([gapiPromise, gisPromise]);
        const loginBtn = document.getElementById('gdrive-login-btn');
        loginBtn.disabled = false;
        loginBtn.classList.remove('bg-gray-400', 'cursor-not-allowed');
        loginBtn.classList.add('bg-gray-600', 'hover:bg-gray-500');
        document.getElementById('gdrive-login-text').textContent = '登入 Google';
    } catch (error) {
        // 如果初始化過程中發生任何錯誤
        console.error("Google API 初始化失敗:", error);
        const loginBtn = document.getElementById('gdrive-login-btn');
        loginBtn.disabled = true;
        loginBtn.classList.remove('bg-gray-400');
        loginBtn.classList.add('bg-red-500', 'cursor-not-allowed');
        document.getElementById('gdrive-login-text').textContent = '載入失敗';
        alert("Google API 初始化失敗！請按 F12 打開開發者工具，查看 Console 中的錯誤訊息。");
    }
}

function handleAuthClick() {
    if (!gapiInited || !gisInited) {
        alert("Google API 尚未初始化，請稍後再試。");
        return;
    }
    if (typeof GOOGLE_API_CONFIG === 'undefined' || !GOOGLE_API_CONFIG.API_KEY || GOOGLE_API_CONFIG.API_KEY.includes('YOUR_')) {
        alert("錯誤：尚未設定 Google API Key，請在程式碼中填入。");
        return;
    }
    tokenClient.requestAccessToken({prompt: 'consent'});
}

function handleSignoutClick() {
    const token = gapi.client.getToken();
    if (token !== null) {
        google.accounts.oauth2.revoke(token.access_token, () => {
            gapi.client.setToken('');
            updateGdriveUI(false);
        });
    }
}

function updateGdriveUI(isLoggedIn) {
    document.getElementById('gdrive-auth-buttons').style.display = isLoggedIn ? 'none' : 'flex';
    document.getElementById('gdrive-action-buttons').style.display = isLoggedIn ? 'flex' : 'none';
}

async function listBackupFiles() {
    const response = await gapi.client.drive.files.list({
        q: "appProperties has { key='travelPlannerBackup' and value='true' } and trashed=false",
        fields: 'files(id, name, modifiedTime)',
        orderBy: 'modifiedTime desc',
        spaces: 'drive'
    });
    return response.result.files || [];
}

async function createNewBackupFile(fileName) {
    const createResponse = await gapi.client.drive.files.create({
        resource: { 
            name: fileName,
            appProperties: {
                travelPlannerBackup: 'true'
            }
        },
        fields: 'id'
    });
    return createResponse.result.id;
}

async function saveToDrive() {
    try {
        const files = await listBackupFiles();
        // 無論如何都顯示彈出視窗，讓使用者選擇覆寫或建立新的
        showGdriveModal('雲端備份', files, async (fileId) => {
            closeGdriveModal();
            if (fileId) { // 如果 fileId 存在，表示使用者選擇了覆寫
                await uploadFileContent(fileId);
            }
        });
    } catch (err) {
        console.error("雲端備份失敗:", err);
        alert("雲端備份失敗，請檢查瀏覽器 Console 的錯誤訊息。");
    }
}

async function handleSaveNewFile() {
    closeGdriveModal();
    try {
        const defaultName = `行程備份_${formatLocalDate()}.json`;
        const fileName = prompt("請輸入新備份的檔案名稱：", defaultName);
        if (!fileName) return; // 使用者取消

        const newFileId = await createNewBackupFile(fileName);
        await uploadFileContent(newFileId);
    } catch (err) {
        console.error("建立新備份失敗:", err);
        alert("建立新備份失敗，請檢查瀏覽器 Console 的錯誤訊息。");
    }
}

async function uploadFileContent(fileId) {
    const packageData = { itinerary: itineraryData, images: uploadedImages, packing: packingList, preTrip: preTripItems, preTripCategories: preTripCategoryOptions, rates: currencyData, categories: categoryOptions };
    const fileContent = JSON.stringify(packageData, null, 2);

    await gapi.client.request({
        path: `/upload/drive/v3/files/${fileId}`,
        method: 'PATCH',
        params: { uploadType: 'media' },
        headers: { 'Content-Type': 'application/json' },
        body: fileContent
    });
    alert(`成功備份至 Google Drive！`);
}

async function loadFromDrive() {
    try {
         const files = await listBackupFiles();
         if (files.length === 0) {
             alert("Google Drive 上沒有找到任何備份檔案。");
             return;
         }
 
         showGdriveModal('選擇要讀取的備份', files, async (fileId) => {
             if (!fileId) return; // 如果使用者取消選擇
             closeGdriveModal();
             try {
                 const response = await gapi.client.drive.files.get({ fileId: fileId, alt: 'media' });
                 if (response.result) {
                     processImportedData(response.result);
                 }
             } catch (err) {
                 console.error("從雲端讀取特定檔案失敗:", err);
                 alert("讀取檔案內容失敗！");
             }
         });
    } catch (err) {
        console.error("從雲端讀取失敗:", err);
        alert("從雲端讀取失敗，可能是雲端上尚未有備份檔案，或是授權已過期。");
    }
}

function showGdriveModal(title, files, callback) {
    const modal = document.getElementById('gdrive-file-modal');
    const fileList = document.getElementById('gdrive-file-list');
    const newBtn = document.getElementById('gdrive-modal-new-btn');
    document.getElementById('gdrive-modal-title').textContent = title;
    fileList.innerHTML = '';

    if (files.length === 0) {
        fileList.innerHTML = '<p class="text-slate-500 text-center py-4">沒有找到任何備份檔案。</p>';
    } else {
        files.forEach(file => {
            const fileEl = document.createElement('div');
            fileEl.className = 'p-3 hover:bg-slate-100 rounded cursor-pointer border-b flex justify-between items-center';
            const details = document.createElement('div');
            const name = document.createElement('div');
            name.className = 'font-bold text-slate-800';
            name.textContent = String(file.name || '未命名備份');
            const modified = document.createElement('div');
            modified.className = 'text-xs text-slate-500 mt-1';
            const modifiedDate = new Date(file.modifiedTime);
            modified.textContent = `上次修改：${Number.isNaN(modifiedDate.getTime()) ? '未知' : modifiedDate.toLocaleString()}`;
            const action = document.createElement('span');
            action.className = 'text-xs font-bold text-orange-600';
            action.textContent = '覆寫';
            details.append(name, modified);
            fileEl.append(details, action);
            fileEl.onclick = () => callback(file.id);
            fileList.appendChild(fileEl);
        });
    }

    // 只有在 "儲存/覆寫" 時才顯示 "建立新備份" 按鈕
    newBtn.style.display = title.includes('備份') ? 'block' : 'none';
    modal.classList.remove('hidden');
}

function closeGdriveModal() {
    document.getElementById('gdrive-file-modal').classList.add('hidden');
}
