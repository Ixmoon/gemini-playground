/// <reference lib="dom" />
// src/admin/admin.ts

document.addEventListener('DOMContentLoaded', () => {
    const messageArea = document.getElementById('message-area') as HTMLDivElement;

    const passwordSetupForm = document.getElementById('password-setup-form') as HTMLDivElement;
    const newAdminPasswordInput = document.getElementById('new-admin-password') as HTMLInputElement;
    const setInitialPasswordBtn = document.getElementById('set-initial-password-btn') as HTMLButtonElement;

    const loginForm = document.getElementById('login-form') as HTMLDivElement;
    const adminPasswordInput = document.getElementById('admin-password') as HTMLInputElement;
    const loginBtn = document.getElementById('login-btn') as HTMLButtonElement;
    
    const logoutSection = document.getElementById('logout-section') as HTMLDivElement;
    const logoutBtn = document.getElementById('logout-btn') as HTMLButtonElement;

    const managementContent = document.getElementById('management-content') as HTMLDivElement;

    const currentAdminPasswordInput = document.getElementById('current-admin-password') as HTMLInputElement;
    const changeAdminPasswordInput = document.getElementById('change-admin-password') as HTMLInputElement;
    const changePasswordBtn = document.getElementById('change-password-btn') as HTMLButtonElement;

    // Single Trigger Key elements
    const triggerKeyInput = document.getElementById('trigger-key-input') as HTMLInputElement;
    const setTriggerKeyBtn = document.getElementById('set-trigger-key-btn') as HTMLButtonElement;
    const clearTriggerKeyBtn = document.getElementById('clear-trigger-key-btn') as HTMLButtonElement;

    const apiKeysInput = document.getElementById('api-keys-input') as HTMLTextAreaElement;
    const addApiKeysBtn = document.getElementById('add-api-keys-btn') as HTMLButtonElement;
    const apiKeysList = document.getElementById('api-keys-list') as HTMLUListElement;
    const apiKeysCountSpan = document.getElementById('api-keys-count') as HTMLSpanElement;
    const clearAllApiKeysBtn = document.getElementById('clear-all-api-keys-btn') as HTMLButtonElement;

    // Fallback API Key elements
    const fallbackApiKeyInput = document.getElementById('fallback-api-key-input') as HTMLInputElement;
    const setFallbackApiKeyBtn = document.getElementById('set-fallback-api-key-btn') as HTMLButtonElement;
    const clearFallbackApiKeyBtn = document.getElementById('clear-fallback-api-key-btn') as HTMLButtonElement;

    const secondaryPoolModelsInput = document.getElementById('secondary-pool-models-input') as HTMLTextAreaElement;
    const setSecondaryPoolModelsBtn = document.getElementById('set-secondary-pool-models-btn') as HTMLButtonElement;
    const secondaryPoolModelsList = document.getElementById('secondary-pool-models-list') as HTMLUListElement;
    const secondaryPoolModelsCountSpan = document.getElementById('secondary-pool-models-count') as HTMLSpanElement;
    const clearAllSecondaryPoolModelsBtn = document.getElementById('clear-all-secondary-pool-models-btn') as HTMLButtonElement;

    const failureThresholdInput = document.getElementById('failure-threshold-input') as HTMLInputElement;
    const setFailureThresholdBtn = document.getElementById('set-failure-threshold-btn') as HTMLButtonElement;

    const API_BASE_URL: string = '/api/admin';
    let currentSessionPassword: string | null = null; // Store password for current "session" (page load)

    function showMessage(message: string, type: 'success' | 'error' = 'success'): void {
        if (messageArea) {
            messageArea.textContent = message;
            messageArea.className = type; // 'success' or 'error'
            setTimeout(() => { 
                if (messageArea) {
                    messageArea.textContent = ''; 
                    messageArea.className = ''; 
                }
            }, 5000);
        }
    }

    async function apiRequest(endpoint: string, method: string = 'GET', body: any = null, useSessionPassword: boolean = true): Promise<any | null> {
        const headers: HeadersInit = { 'Content-Type': 'application/json' };
        if (useSessionPassword && currentSessionPassword && method !== 'GET') {
            (headers as Record<string, string>)['X-Admin-Password'] = currentSessionPassword;
        }

        const options: RequestInit = { method, headers };
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
        } catch (err: any) {
            showMessage(`Network or server error: ${err.message}`, 'error');
            return null;
        }
    }

    function renderKeyList(listElement: HTMLUListElement, keys: string[] | null | undefined, type: 'api' | 'model' | 'trigger', countElement: HTMLSpanElement | null): void {
        if (!listElement) return;
        listElement.innerHTML = '';
        const count = keys ? keys.length : 0;
        if (countElement) {
            countElement.textContent = String(count);
        }

        // If type is 'trigger', we don't render a list anymore.
        // This function is now only for 'api' (pool) and 'model' (list of names)
        if (type === 'trigger') {
            // This part of the function will not be called for trigger keys with the new setup.
            // If it were, we'd clear the list or handle it appropriately.
            listElement.innerHTML = ''; // Clear if it was a list before
            if (countElement) countElement.textContent = 'N/A'; // Or hide it
            return;
        }

        if (count === 0) {
            listElement.innerHTML = '<li>无</li>';
            return;
        }

        // Filter out non-string or null items to prevent errors during rendering
        const validItems = keys ? keys.filter((key: string | null): key is string => typeof key === 'string' && key !== null) : [];


        if (validItems.length === 0) {
            listElement.innerHTML = `<li>无有效${type === 'api' ? '密钥' : '模型'}可显示。</li>`;
            if (countElement) { // Update count if all items were invalid
                countElement.textContent = '0';
            }
            return;
        }

        validItems.forEach((item: string) => { 
            const li = document.createElement('li');
            const itemSpan = document.createElement('span');
            itemSpan.textContent = item; 
            li.appendChild(itemSpan);

            if (type === 'api') { // Only for primary API key pool items
                const deleteBtn = document.createElement('button');
                deleteBtn.textContent = '删除';
                deleteBtn.classList.add('danger');
                deleteBtn.onclick = async () => {
                    if (confirm(`确定要删除目标 API 密钥 "${item}"吗?`)) {
                        const result = await apiRequest('/api-keys', 'DELETE', { key: item }, true);
                        if (result) {
                            showMessage(result.message || `"${item}" 已删除。`, 'success');
                            loadManagementData();
                        }
                    }
                };
                li.appendChild(deleteBtn);
            }
            // For 'model' type, no individual delete button is added here.
            listElement.appendChild(li);
        });
    }

    async function loadManagementData(): Promise<void> {
        // Load Single Trigger Key
        const triggerKeyData = await apiRequest('/trigger-key', 'GET', null, false);
        if (triggerKeyData && typeof triggerKeyData.key === 'string') {
            if (triggerKeyInput) triggerKeyInput.value = triggerKeyData.key || '';
        }

        const apiKeysData = await apiRequest('/api-keys', 'GET', null, false);
        let processedApiKeys: string[] = [];
        if (apiKeysData && typeof apiKeysData === 'object' && !Array.isArray(apiKeysData)) {
            processedApiKeys = Object.values(apiKeysData);
        } else if (Array.isArray(apiKeysData)) { // Accept array directly
            processedApiKeys = apiKeysData;
        } else if (apiKeysData !== null) { // apiKeysData is not null, but not the expected object format
            showMessage('从服务器收到的目标 API 密钥数据格式不正确。', 'error');
        }
        // Ensure apiKeysList exists before rendering.
        if (apiKeysList && apiKeysCountSpan) renderKeyList(apiKeysList, processedApiKeys, 'api', apiKeysCountSpan);

        // Load Fallback API Key
        const fallbackApiKeyData = await apiRequest('/fallback-api-key', 'GET', null, false);
        if (fallbackApiKeyData && typeof fallbackApiKeyData.key === 'string') {
            if (fallbackApiKeyInput) fallbackApiKeyInput.value = fallbackApiKeyData.key || ''; // Set to empty string if null
        }
        
        const secondaryPoolModelsData = await apiRequest('/secondary-pool-models', 'GET', null, false);
        let processedSecondaryPoolModels: string[] = [];
        if (Array.isArray(secondaryPoolModelsData)) {
            processedSecondaryPoolModels = secondaryPoolModelsData;
        } else if (secondaryPoolModelsData !== null) { // secondaryPoolModelsData is not null, but not an array
            showMessage('从服务器收到的备用池模型数据格式不正确。', 'error');
        }
        // Ensure secondaryPoolModelsList exists before rendering.
        if (secondaryPoolModelsList && secondaryPoolModelsCountSpan) renderKeyList(secondaryPoolModelsList, processedSecondaryPoolModels, 'model', secondaryPoolModelsCountSpan);

        const thresholdData = await apiRequest('/failure-threshold', 'GET', null, false);
        if (thresholdData && typeof thresholdData.threshold === 'number') {
            if (failureThresholdInput) failureThresholdInput.value = String(thresholdData.threshold);
        }
    }

    function showPasswordSetupForm(): void {
        if (passwordSetupForm) passwordSetupForm.classList.remove('hidden');
        if (loginForm) loginForm.classList.add('hidden');
        if (managementContent) managementContent.classList.add('hidden');
        if (logoutSection) logoutSection.classList.add('hidden');
    }

    function showLoginForm(): void {
        if (passwordSetupForm) passwordSetupForm.classList.add('hidden');
        if (loginForm) loginForm.classList.remove('hidden');
        if (managementContent) managementContent.classList.add('hidden');
        if (logoutSection) logoutSection.classList.add('hidden');
        currentSessionPassword = null; // Clear session password on showing login
    }

    function showManagementContent(): void {
        if (passwordSetupForm) passwordSetupForm.classList.add('hidden');
        if (loginForm) loginForm.classList.add('hidden');
        if (managementContent) managementContent.classList.remove('hidden');
        if (logoutSection) logoutSection.classList.remove('hidden');
        loadManagementData();
    }

    async function checkInitialStatus(): Promise<void> {
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

    if (setInitialPasswordBtn && newAdminPasswordInput) {
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
    }

    if (loginBtn && adminPasswordInput) {
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
    }
    
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            currentSessionPassword = null;
            showMessage('已登出。', 'success');
            showLoginForm();
        });
    }

    if (changePasswordBtn && currentAdminPasswordInput && changeAdminPasswordInput) {
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
            const result = await apiRequest('/change-password', 'POST', { newPassword }, true);
            if (result) {
                showMessage(result.message || '密码更改成功!', 'success');
                currentAdminPasswordInput.value = '';
                changeAdminPasswordInput.value = '';
                // Update session password if change was successful
                currentSessionPassword = newPassword;
            }
        });
    }

    // Event Listener for Single Trigger Key
    if (setTriggerKeyBtn && triggerKeyInput) {
        setTriggerKeyBtn.addEventListener('click', async () => {
            const key = triggerKeyInput.value.trim();
            // API handles empty string as clearing the key.
            const result = await apiRequest('/trigger-key', 'POST', { key: key }, true);
            if (result) {
                showMessage(result.message || '触发密钥已更新。', 'success');
                loadManagementData(); // Reload to confirm
            }
        });
    }

    if (clearTriggerKeyBtn && triggerKeyInput) {
        clearTriggerKeyBtn.addEventListener('click', async () => {
            if (confirm('确定要清除触发密钥吗？')) {
                const result = await apiRequest('/trigger-key', 'DELETE', null, true);
                if (result) {
                    showMessage(result.message || '触发密钥已清除。', 'success');
                    triggerKeyInput.value = ''; // Clear input field
                    loadManagementData(); // Reload
                }
            }
        });
    }

    if (addApiKeysBtn && apiKeysInput) {
        addApiKeysBtn.addEventListener('click', async () => {
            const keys = apiKeysInput.value;
            if (!keys.trim()) {
                showMessage('请输入要添加的目标 API 密钥。', 'error');
                return;
            }
            const result = await apiRequest('/api-keys', 'POST', { keys }, true);
            if (result) {
                showMessage(result.message || '目标 API 密钥已添加/更新。', 'success');
                apiKeysInput.value = '';
                loadManagementData();
            }
        });
    }

    if (setFailureThresholdBtn && failureThresholdInput) {
        setFailureThresholdBtn.addEventListener('click', async () => {
            const threshold = parseInt(failureThresholdInput.value, 10);
            if (isNaN(threshold) || threshold < 1) {
                showMessage('失败阈值必须是大于0的数字。', 'error');
                return;
            }
            const result = await apiRequest('/failure-threshold', 'POST', { threshold }, true);
            if (result) {
                showMessage(result.message || `失败阈值已设置为 ${threshold}。`, 'success');
                loadManagementData(); // Reload to confirm or if GET returns it
            }
        });
    }

    // clearAllTriggerKeysBtn is now clearTriggerKeyBtn, handled above.

    if (clearAllApiKeysBtn) {
        clearAllApiKeysBtn.addEventListener('click', async () => {
            if (confirm('确定要清空所有目标 API 密钥吗？此操作无法撤销，并将重置相关统计数据。')) {
                const result = await apiRequest('/api-keys/all', 'DELETE', null, true);
                if (result) {
                    showMessage(result.message || '所有目标 API 密钥已清空。', 'success');
                    loadManagementData();
                }
            }
        });
    }

    // Initial check
    checkInitialStatus();

    // --- Event Listener for Fallback API Key ---
    if (setFallbackApiKeyBtn && fallbackApiKeyInput) {
        setFallbackApiKeyBtn.addEventListener('click', async () => {
            const key = fallbackApiKeyInput.value.trim(); // Send empty string to clear, or the key itself
            // The API endpoint /fallback-api-key with POST will handle empty string as clearing the key.
            const result = await apiRequest('/fallback-api-key', 'POST', { key: key }, true);
            if (result) {
                showMessage(result.message || '备用 API 密钥已更新。', 'success');
                loadManagementData(); // Reload to confirm the input field reflects the change
            }
        });
    }

    if (clearFallbackApiKeyBtn && fallbackApiKeyInput) {
        clearFallbackApiKeyBtn.addEventListener('click', async () => {
            if (confirm('确定要清除备用 API 密钥吗？')) {
                // Sending empty string or null via POST is one way, or use dedicated DELETE
                const result = await apiRequest('/fallback-api-key', 'DELETE', null, true); 
                if (result) {
                    showMessage(result.message || '备用 API 密钥已清除。', 'success');
                    fallbackApiKeyInput.value = ''; // Clear the input field
                    loadManagementData(); // Reload data
                }
            }
        });
    }

    // --- Event Listeners for Secondary Pool Model Names ---
    if (setSecondaryPoolModelsBtn && secondaryPoolModelsInput) {
        setSecondaryPoolModelsBtn.addEventListener('click', async () => {
            const models = secondaryPoolModelsInput.value;
            // No trim check here, as sending an empty string is how we clear the list via POST
            const result = await apiRequest('/secondary-pool-models', 'POST', { models }, true);
            if (result) {
                showMessage(result.message || '备用池触发模型列表已更新。', 'success');
                secondaryPoolModelsInput.value = ''; // Clear input after successful set
                loadManagementData();
            }
        });
    }

    if (clearAllSecondaryPoolModelsBtn) {
        clearAllSecondaryPoolModelsBtn.addEventListener('click', async () => {
            if (confirm('确定要清空所有备用池触发模型吗？此操作无法撤销。')) {
                // We can use the POST endpoint with an empty string/array, 
                // or use the dedicated /clear endpoint if available.
                // The current admin_api.ts has /secondary-pool-models/clear
                const result = await apiRequest('/secondary-pool-models/clear', 'DELETE', null, true);
                if (result) {
                    showMessage(result.message || '所有备用池触发模型已清空。', 'success');
                    loadManagementData();
                }
            }
        });
    }
});
