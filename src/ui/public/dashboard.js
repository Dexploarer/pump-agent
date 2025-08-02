// Dashboard JavaScript
class PumpAgentDashboard {
    constructor() {
        this.socket = null;
        this.platformChart = null;
        this.lastUpdate = new Date();
        this.init();
    }

    init() {
        this.connectSocket();
        this.initCharts();
        this.loadInitialData();
        this.setupAutoRefresh();
    }

    connectSocket() {
        this.socket = io();
        
        this.socket.on('connect', () => {
            this.updateStatus('Connected', 'online');
            console.log('Connected to server');
        });

        this.socket.on('disconnect', () => {
            this.updateStatus('Disconnected', 'offline');
            console.log('Disconnected from server');
        });

        this.socket.on('data-update', (data) => {
            this.handleDataUpdate(data);
        });
    }

    updateStatus(text, status) {
        document.getElementById('status-text').textContent = text;
        const statusDot = document.getElementById('status-dot');
        statusDot.className = `status-dot ${status}`;
    }

    initCharts() {
        const ctx = document.getElementById('platform-chart').getContext('2d');
        this.platformChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: [],
                datasets: [{
                    data: [],
                    backgroundColor: [
                        '#ff8c00', // pump.fun
                        '#ff6b00', // letsbonk.fun
                        '#ff4444', // bonkake.fun
                        '#00ff88', // success green
                        '#ff8c00', // fallback
                        '#ff6b00'  // fallback
                    ],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            padding: 20,
                            usePointStyle: true,
                            color: '#e0e0e0',
                            font: {
                                size: 12,
                                weight: '600'
                            }
                        }
                    }
                }
            }
        });
    }

    async loadInitialData() {
        await Promise.all([
            this.loadSystemStatus(),
            this.loadTokenStats(),
            this.loadPlatformStats(),
            this.loadRecentTrades(),
            this.loadRecentTokens(),
            this.loadLogs()
        ]);
    }

    async loadSystemStatus() {
        try {
            const response = await fetch('/api/status');
            const data = await response.json();
            this.displaySystemStatus(data);
        } catch (error) {
            console.error('Failed to load system status:', error);
            document.getElementById('system-status').innerHTML = 
                '<div class="error">Failed to load system status</div>';
        }
    }

    async loadTokenStats() {
        try {
            const response = await fetch('/api/stats');
            const data = await response.json();
            this.displayTokenStats(data);
        } catch (error) {
            console.error('Failed to load token stats:', error);
            document.getElementById('token-stats').innerHTML = 
                '<div class="error">Failed to load token statistics</div>';
        }
    }

    async loadPlatformStats() {
        try {
            const response = await fetch('/api/platform-stats');
            const data = await response.json();
            this.updatePlatformChart(data);
        } catch (error) {
            console.error('Failed to load platform stats:', error);
        }
    }

    async loadRecentTrades() {
        try {
            const response = await fetch('/api/recent-trades');
            const data = await response.json();
            this.displayRecentTrades(data);
        } catch (error) {
            console.error('Failed to load recent trades:', error);
            document.getElementById('recent-trades').innerHTML = 
                '<div class="error">Failed to load recent trades</div>';
        }
    }

    async loadRecentTokens() {
        try {
            const response = await fetch('/api/tokens?limit=20');
            const data = await response.json();
            this.displayRecentTokens(data);
        } catch (error) {
            console.error('Failed to load recent tokens:', error);
            document.getElementById('recent-tokens').innerHTML = 
                '<div class="error">Failed to load recent tokens</div>';
        }
    }

    async loadLogs() {
        try {
            const response = await fetch('/api/logs?limit=50');
            const data = await response.json();
            this.displayLogs(data);
        } catch (error) {
            console.error('Failed to load logs:', error);
            document.getElementById('app-logs').innerHTML = 
                '<div class="error">Failed to load logs</div>';
        }
    }

    displaySystemStatus(data) {
        const container = document.getElementById('system-status');
        const uptime = this.formatUptime(data.uptime);
        const memory = this.formatBytes(data.memory.heapUsed);

        container.innerHTML = `
            <div class="stats-grid">
                <div class="stat-item">
                    <div class="stat-value">${data.database.connected ? 'Connected' : 'Disconnected'}</div>
                    <div class="stat-label">Database</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${uptime}</div>
                    <div class="stat-label">Uptime</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${memory}</div>
                    <div class="stat-label">Memory</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${data.platform}</div>
                    <div class="stat-label">Platform</div>
                </div>
            </div>
        `;
    }

    displayTokenStats(data) {
        const container = document.getElementById('token-stats');
        
        // Ensure data is an array
        if (!data || !Array.isArray(data)) {
            container.innerHTML = `
                <div class="stats-grid">
                    <div class="stat-item">
                        <div class="stat-value">0</div>
                        <div class="stat-label">Total Tokens</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-value">0</div>
                        <div class="stat-label">Total Volume</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-value">$0.0000</div>
                        <div class="stat-label">Avg Price</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-value">N/A</div>
                        <div class="stat-label">Last Update</div>
                    </div>
                </div>
            `;
            return;
        }
        
        const totalTokens = data.length || 0;
        const totalVolume = data.reduce((sum, item) => sum + (item.totalVolume || 0), 0);
        const avgPrice = data.length > 0 ? 
            data.reduce((sum, item) => sum + (item.avgPrice || 0), 0) / data.length : 0;

        container.innerHTML = `
            <div class="stats-grid">
                <div class="stat-item">
                    <div class="stat-value">${totalTokens}</div>
                    <div class="stat-label">Total Tokens</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${this.formatNumber(totalVolume)}</div>
                    <div class="stat-label">Total Volume</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">$${avgPrice.toFixed(4)}</div>
                    <div class="stat-label">Avg Price</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${data.length > 0 ? data[0].timestamp : 'N/A'}</div>
                    <div class="stat-label">Last Update</div>
                </div>
            </div>
        `;
    }

    updatePlatformChart(data) {
        if (!this.platformChart) return;

        const labels = Object.keys(data);
        const values = Object.values(data);

        this.platformChart.data.labels = labels;
        this.platformChart.data.datasets[0].data = values;
        this.platformChart.update();
    }

    displayRecentTrades(trades) {
        const container = document.getElementById('recent-trades');
        
        // Ensure trades is an array
        if (!trades || !Array.isArray(trades) || trades.length === 0) {
            container.innerHTML = '<div class="loading">No recent trades found</div>';
            return;
        }

        const tradesHtml = trades.map(trade => `
            <div class="token-item">
                <div class="token-info">
                    <div class="token-symbol">${trade.symbol || 'Unknown'}</div>
                    <div class="token-name">${trade.mint || 'Unknown Mint'}</div>
                </div>
                <div class="token-price">
                    $${(trade.price || 0).toFixed(6)}
                </div>
            </div>
        `).join('');

        container.innerHTML = tradesHtml;
    }

    displayRecentTokens(tokens) {
        const container = document.getElementById('recent-tokens');
        
        // Ensure tokens is an array
        if (!tokens || !Array.isArray(tokens) || tokens.length === 0) {
            container.innerHTML = '<div class="loading">No tokens found</div>';
            return;
        }

        const tokensHtml = tokens.map(token => `
            <div class="token-item">
                <div class="token-info">
                    <div class="token-symbol">${token.symbol || 'Unknown'}</div>
                    <div class="token-name">${token.name || 'Unknown Name'}</div>
                </div>
                <div class="token-platform">${token.platform || 'Unknown'}</div>
                <div class="token-price">
                    $${(token.price || 0).toFixed(6)}
                </div>
            </div>
        `).join('');

        container.innerHTML = tokensHtml;
    }

    displayLogs(logs) {
        const container = document.getElementById('app-logs');
        
        // Ensure logs is an array
        if (!logs || !Array.isArray(logs) || logs.length === 0) {
            container.innerHTML = '<div class="loading">No logs available</div>';
            return;
        }

        const logsHtml = logs.map(log => {
            const timestamp = new Date(log.timestamp || Date.now()).toLocaleTimeString();
            const level = log.level || 'INFO';
            const message = log.message || 'No message';
            
            return `
                <div class="log-entry">
                    <span class="log-timestamp">[${timestamp}]</span>
                    <span class="log-level-${level}">[${level}]</span>
                    <span>${message}</span>
                </div>
            `;
        }).join('');

        container.innerHTML = logsHtml;
    }

    handleDataUpdate(data) {
        this.lastUpdate = new Date();
        document.getElementById('last-update').textContent = 
            `Last updated: ${this.lastUpdate.toLocaleTimeString()}`;

        try {
            if (data.tokens) {
                this.displayRecentTokens(data.tokens);
            }
            if (data.stats) {
                this.displayTokenStats(data.stats);
            }
            if (data.recentTrades) {
                this.displayRecentTrades(data.recentTrades);
            }
        } catch (error) {
            console.error('Error handling data update:', error);
        }
    }

    setupAutoRefresh() {
        // Auto-refresh every 30 seconds
        setInterval(() => {
            this.loadSystemStatus();
        }, 30000);
    }

    formatUptime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        return `${hours}h ${minutes}m`;
    }

    formatBytes(bytes) {
        const mb = bytes / 1024 / 1024;
        return `${mb.toFixed(1)} MB`;
    }

    formatNumber(num) {
        if (num >= 1000000) {
            return (num / 1000000).toFixed(1) + 'M';
        }
        if (num >= 1000) {
            return (num / 1000).toFixed(1) + 'K';
        }
        return num.toFixed(0);
    }
}

// Global refresh functions
window.refreshStatus = () => {
    dashboard.loadSystemStatus();
};

window.refreshStats = () => {
    dashboard.loadTokenStats();
};

window.refreshPlatformStats = () => {
    dashboard.loadPlatformStats();
};

window.refreshTrades = () => {
    dashboard.loadRecentTrades();
};

window.refreshTokens = () => {
    dashboard.loadRecentTokens();
};

window.refreshLogs = () => {
    dashboard.loadLogs();
};

// Initialize dashboard
const dashboard = new PumpAgentDashboard(); 