// src/admin/admin.js

document.addEventListener('DOMContentLoaded', () => {
    const messageArea = document.getElementById('message-area');

    const authSection = document.getElementById('auth-section');
    const passwordSetupForm = document.getElementById('password-setup-form');
    const newAdminPasswordInput = document.getElementById('new-admin-password');
    const setInitialPasswordBtn = document.getElementById('set-initial-password-btn');

    const loginForm = document.getElementById('login-form');
    const adminPasswordInput = document.getElementById('admin-password');
    const loginBtn = document.getElementById('login-btn');
    
    const logoutSection = document.getElementById('logout-section');
    const logoutBtn = document.getElementById('logout-btn');

    const managementContent = document.getElementById('management-content');

    const currentAdminPasswordInput = document.getElementById('current-admin-password');
    const changeAdminPasswordInput = document.getElementById('change-admin-password');
    const changePasswordBtn = document.getElementById('change-password-btn');

    const triggerKeysInput = document.getElementById('trigger-keys-input');
    const addTriggerKeysBtn = document.getElementById('add-trigger-keys-btn');
    const triggerKeysList = document.getElementById('trigger-keys-list');
    const triggerKeysCountSpan = document.getElementById('trigger-keys-count');
    const clearAllTriggerKeysBtn = document.getElementById('clear-all-trigger-keys-btn');

    const apiKeysInput = document.getElementById('api-keys-input');
    const addApiKeysBtn = document.getElementById('add-api-keys-btn');
    const apiKeysList = document.getElementById('api-keys-list');
    const apiKeysCountSpan = document.getElementById('api-keys-count');
    const clearAllApiKeysBtn = document.getElementById('clear-all-api-keys-btn');

    const failureThresholdInput = document.getElementById('failure-threshold-input');
    const setFailureThresholdBtn = document.getElementById('set-failure-threshold-btn');

    const API_BASE_URL = '/api/admin';
    let currentSessionPassword = null; // Store password for current "session" (page load)

    function showMessage(message, type = 'success') {
        messageArea.textContent = message;
        messageArea.className = type; // 'success' or 'error'
        setTimeout(() => { messageArea.textContent = ''; messageArea.className = ''; }, 5000);
    }

    async function apiRequest(endpoint, method = 'GET', body = null, useSessionPassword = true) {
        const headers = { 'Content-Type': 'application/json' };
        if (useSessionPassword && currentSessionPassword && method !== 'GET') {
            headers['X-Admin-Password'] = currentSessionPassword;
        }

        const options = { method, headers };
        if (body) {
            options.body = JSON.stringify(body);
        }

        try {
            const response = await fetch(`${API_BASE_URL}${endpoint}`, options);
            const responseData = await response.json().catch(() => ({})); // Catch if no JSON body

            if (!response.ok) {
                const errorMsg = responseData.error || `Error ${response.status}: ${response.statusText}`;
                showMessage(errorMsg, 'error');
                if (response.status === 401 && endpoint !== '/login') { // Unauthorized
                    showLoginForm(); // Force re-login if not already on login
                }
                return null;
            }
            return responseData;
        } catch (err) {
            showMessage(`Network or server error: ${err.message}`, 'error');
            return null;
        }
    }

    function renderKeyList(listElement, keys, type, countElement) {
        listElement.innerHTML = '';
        const count = keys ? keys.length : 0;
        if (countElement) {
            countElement.textContent = count;
        }

        if (count === 0) {
            listElement.innerHTML = '<li>无</li>';
            return;
        }
        keys.forEach(key => {
            const li = document.createElement('li');
            const keySpan = document.createElement('span');
            // For API keys, show only a portion for security if desired, but admin needs to see full.
            keySpan.textContent = key; 
            li.appendChild(keySpan);

            const deleteBtn = document.createElement('button');
            deleteBtn.textContent = '删除';
            deleteBtn.classList.add('danger');
            deleteBtn.onclick = async () => {
                if (confirm(`确定要删除密钥 "${key}"吗?`)) {
                    const endpoint = type === 'trigger' ? '/trigger-keys' : '/api-keys';
                    const result = await apiRequest(endpoint, 'DELETE', { key });
                    if (result) {
                        showMessage(result.message || `密钥 "${key}" 已删除。`, 'success');
                        loadManagementData();
                    }
                }
            };
            li.appendChild(deleteBtn);
            listElement.appendChild(li);
        });
    }

    async function loadManagementData() {
        const triggerKeysData = await apiRequest('/trigger-keys', 'GET', null, false);
        if (triggerKeysData) renderKeyList(triggerKeysList, triggerKeysData, 'trigger', triggerKeysCountSpan);

        const apiKeysData = await apiRequest('/api-keys', 'GET', null, false);
        if (apiKeysData) renderKeyList(apiKeysList, apiKeysData, 'api', apiKeysCountSpan);

        const thresholdData = await apiRequest('/failure-threshold', 'GET', null, false);
        if (thresholdData && typeof thresholdData.threshold !== 'undefined') {
            failureThresholdInput.value = thresholdData.threshold;
        }
    }

    function showPasswordSetupForm() {
        passwordSetupForm.classList.remove('hidden');
        loginForm.classList.add('hidden');
        managementContent.classList.add('hidden');
        logoutSection.classList.add('hidden');
    }

    function showLoginForm() {
        passwordSetupForm.classList.add('hidden');
        loginForm.classList.remove('hidden');
        managementContent.classList.add('hidden');
        logoutSection.classList.add('hidden');
        currentSessionPassword = null; // Clear session password on showing login
    }

    function showManagementContent() {
        passwordSetupForm.classList.add('hidden');
        loginForm.classList.add('hidden');
        managementContent.classList.remove('hidden');
        logoutSection.classList.remove('hidden');
        loadManagementData();
    }

    async function checkInitialStatus() {
        // Check if admin password is set up by trying to get a protected resource or a specific status
        // A dedicated status endpoint that reveals if setup is needed would be better.
        // For now, we'll try to fetch trigger keys. If it's 401 and no password is set, assume setup needed.
        // This is a bit of a hack. The backend /api/admin/password-setup should be the primary guide.
        
        // A better approach: have a specific endpoint like /api/admin/initial-status
        // For now, let's assume if login fails with "password not set up", we show setup.
        // Or, we can try to fetch a harmless GET endpoint that doesn't require auth to see if API is up.
        const statusData = await apiRequest('/status', 'GET', null, false);
        if (!statusData) {
            showMessage("无法连接到管理 API。请检查服务器是否正在运行。", "error");
            return;
        }

        // Attempt to get trigger keys (a GET that might indicate if auth is generally working or needed)
        // This is not ideal for detecting initial setup, as GETs are not auth-protected in current admin_api.
        // The backend should ideally tell us if setup is needed.
        // Let's assume if we can't get a password hash, setup is needed.
        // This check should be done by trying to login or a specific status endpoint.
        // For now, we'll try to login with an empty password to see if "not set up" error occurs.
        
        const loginAttempt = await fetch(`${API_BASE_URL}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: "" }) // Try with empty to provoke "not set up"
        });
        const loginData = await loginAttempt.json().catch(() => ({}));

        if (loginAttempt.status === 401 && loginData.error === "Admin password not set up.") {
            showPasswordSetupForm();
        } else {
            // If already "logged in" via a previous page load (e.g. browser remembers password via its manager)
            // or if no auth is strictly enforced yet for GETs.
            // For this simple client-side session, we always start with login.
            showLoginForm();
        }
    }

    setInitialPasswordBtn.addEventListener('click', async () => {
        const password = newAdminPasswordInput.value;
        if (password.length < 8) {
            showMessage('密码至少需要8个字符。', 'error');
            return;
        }
        const result = await apiRequest('/password-setup', 'POST', { password }, false);
        if (result) {
            showMessage(result.message || '初始密码设置成功!', 'success');
            currentSessionPassword = password; // "Log in" with the new password
            showManagementContent();
        }
    });

    loginBtn.addEventListener('click', async () => {
        const password = adminPasswordInput.value;
        if (!password) {
            showMessage('请输入密码。', 'error');
            return;
        }
        const result = await apiRequest('/login', 'POST', { password }, false);
        if (result && result.message === "Login successful") {
            showMessage('登录成功!', 'success');
            currentSessionPassword = password; // Store for subsequent authenticated requests
            adminPasswordInput.value = ''; // Clear password field
            showManagementContent();
        } else if (result && result.error === "Admin password not set up.") {
            showMessage('管理员密码尚未设置。请先设置初始密码。', 'error');
            showPasswordSetupForm();
        }
        // Other errors are handled by apiRequest
    });
    
    logoutBtn.addEventListener('click', () => {
        currentSessionPassword = null;
        showMessage('已登出。', 'success');
        showLoginForm();
    });

    changePasswordBtn.addEventListener('click', async () => {
        const currentPassword = currentAdminPasswordInput.value; // This should be the one used for the current "session"
        const newPassword = changeAdminPasswordInput.value;

        if (!currentSessionPassword) {
            showMessage('请先登录以更改密码。', 'error');
            showLoginForm();
            return;
        }
         if (currentPassword !== currentSessionPassword) {
            showMessage('当前密码输入不正确。请输入您用于登录此会话的密码。', 'error');
            return;
        }
        if (newPassword.length < 8) {
            showMessage('新密码至少需要8个字符。', 'error');
            return;
        }

        // The change-password endpoint in admin_api.ts uses X-Admin-Password for current pass
        const result = await apiRequest('/change-password', 'POST', { newPassword });
        if (result) {
            showMessage(result.message || '密码更改成功!', 'success');
            currentAdminPasswordInput.value = '';
            changeAdminPasswordInput.value = '';
            // Update session password if change was successful
            currentSessionPassword = newPassword;
        }
    });

    addTriggerKeysBtn.addEventListener('click', async () => {
        const keys = triggerKeysInput.value;
        if (!keys.trim()) {
            showMessage('请输入要添加的触发密钥。', 'error');
            return;
        }
        const result = await apiRequest('/trigger-keys', 'POST', { keys });
        if (result) {
            showMessage(result.message || '触发密钥已添加/更新。', 'success');
            triggerKeysInput.value = '';
            loadManagementData();
        }
    });

    addApiKeysBtn.addEventListener('click', async () => {
        const keys = apiKeysInput.value;
        if (!keys.trim()) {
            showMessage('请输入要添加的目标 API 密钥。', 'error');
            return;
        }
        const result = await apiRequest('/api-keys', 'POST', { keys });
        if (result) {
            showMessage(result.message || '目标 API 密钥已添加/更新。', 'success');
            apiKeysInput.value = '';
            loadManagementData();
        }
    });

    setFailureThresholdBtn.addEventListener('click', async () => {
        const threshold = parseInt(failureThresholdInput.value, 10);
        if (isNaN(threshold) || threshold < 1) {
            showMessage('失败阈值必须是大于0的数字。', 'error');
            return;
        }
        const result = await apiRequest('/failure-threshold', 'POST', { threshold });
        if (result) {
            showMessage(result.message || `失败阈值已设置为 ${threshold}。`, 'success');
            loadManagementData(); // Reload to confirm or if GET returns it
        }
    });

    clearAllTriggerKeysBtn.addEventListener('click', async () => {
        if (confirm('确定要清空所有触发密钥吗？此操作无法撤销。')) {
            const result = await apiRequest('/trigger-keys/all', 'DELETE');
            if (result) {
                showMessage(result.message || '所有触发密钥已清空。', 'success');
                loadManagementData();
            }
        }
    });

    clearAllApiKeysBtn.addEventListener('click', async () => {
        if (confirm('确定要清空所有目标 API 密钥吗？此操作无法撤销，并将重置相关统计数据。')) {
            const result = await apiRequest('/api-keys/all', 'DELETE');
            if (result) {
                showMessage(result.message || '所有目标 API 密钥已清空。', 'success');
                loadManagementData();
            }
        }
    });

    // Initial check
    checkInitialStatus();
});
