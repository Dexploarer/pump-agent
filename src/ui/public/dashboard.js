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
        try {
            await Promise.all([
                this.loadSystemStatus(),
                this.loadTokenStats(),
                this.loadPlatformStats(),
                this.loadRecentTrades(),
                this.loadRecentTokens(),
                this.loadLogs()
            ]);
        } catch (error) {
            console.error('Failed to load initial data:', error);
        }
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
            const response = await fetch('/api/tokens');
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
            const response = await fetch('/api/logs');
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
        
        if (!data || typeof data !== 'object') {
            container.innerHTML = '<div class="error">Invalid system status data</div>';
            return;
        }

        const stats = [
            { label: 'Uptime', value: this.formatUptime(data.uptime || 0) },
            { label: 'Memory', value: this.formatBytes(data.memory?.heapUsed || 0) },
            { label: 'Platform', value: data.platform || 'Unknown' },
            { label: 'Node Version', value: data.nodeVersion || 'Unknown' },
            { label: 'Database', value: data.database?.connected ? 'Connected' : 'Disconnected' }
        ];

        const statsHtml = stats.map(stat => `
            <div class="stat-item">
                <div class="stat-value">${stat.value}</div>
                <div class="stat-label">${stat.label}</div>
            </div>
        `).join('');

        container.innerHTML = `
            <div class="stats-grid">
                ${statsHtml}
            </div>
        `;
    }

    displayTokenStats(data) {
        const container = document.getElementById('token-stats');
        
        if (!data || typeof data !== 'object') {
            container.innerHTML = '<div class="error">Invalid token statistics data</div>';
            return;
        }

        const stats = [
            { label: 'Total Tokens', value: this.formatNumber(data.totalTokens || 0) },
            { label: 'Platforms', value: Object.keys(data.tokensByPlatform || {}).length },
            { label: 'Recent Activity', value: this.formatNumber(data.recentActivity?.tokens || 0) },
            { label: 'Trades', value: this.formatNumber(data.recentActivity?.trades || 0) }
        ];

        const statsHtml = stats.map(stat => `
            <div class="stat-item">
                <div class="stat-value">${stat.value}</div>
                <div class="stat-label">${stat.label}</div>
            </div>
        `).join('');

        container.innerHTML = `
            <div class="stats-grid">
                ${statsHtml}
            </div>
        `;
    }

    updatePlatformChart(data) {
        if (!data || !data.tokensByPlatform) return;

        const labels = Object.keys(data.tokensByPlatform);
        const values = Object.values(data.tokensByPlatform);

        this.platformChart.data.labels = labels;
        this.platformChart.data.datasets[0].data = values;
        this.platformChart.update();
    }

    displayRecentTrades(trades) {
        const container = document.getElementById('recent-trades');
        
        if (!Array.isArray(trades) || trades.length === 0) {
            container.innerHTML = '<div class="loading">No recent trades available</div>';
            return;
        }

        const tradesHtml = trades.slice(0, 6).map(trade => `
            <div class="trade-item">
                <div class="trade-type ${trade.type}">
                    <i class="fas fa-${trade.type === 'buy' ? 'arrow-up' : 'arrow-down'}"></i>
                    ${trade.type.toUpperCase()} ${trade.symbol || 'Unknown'}
                </div>
                <div class="trade-details">
                    <div>Amount: ${this.formatNumber(trade.amount || 0)}</div>
                    <div>Price: ${this.formatNumber(trade.price || 0)} SOL</div>
                    <div>Value: ${this.formatNumber(trade.value || 0)} SOL</div>
                    <div>Platform: ${trade.platform || 'Unknown'}</div>
                </div>
            </div>
        `).join('');

        container.innerHTML = tradesHtml;
    }

    displayRecentTokens(tokens) {
        const container = document.getElementById('recent-tokens');
        
        if (!Array.isArray(tokens) || tokens.length === 0) {
            container.innerHTML = '<div class="loading">No recent tokens available</div>';
            return;
        }

        const tokensHtml = tokens.slice(0, 10).map(token => `
            <div class="token-item">
                <div class="token-info">
                    <div class="token-symbol">${token.symbol || 'Unknown'}</div>
                    <div class="token-name">${token.name || 'Unknown Token'}</div>
                    <div class="token-platform">${token.platform || 'Unknown'}</div>
                </div>
                <div class="token-price">
                    ${this.formatNumber(token.price || 0)} SOL
                </div>
            </div>
        `).join('');

        container.innerHTML = tokensHtml;
    }

    displayLogs(logs) {
        const container = document.getElementById('app-logs');
        
        if (!Array.isArray(logs) || logs.length === 0) {
            container.innerHTML = '<div class="loading">No logs available</div>';
            return;
        }

        const logsHtml = logs.slice(-20).map(log => {
            const level = log.level?.toLowerCase() || 'info';
            const timestamp = new Date(log.timestamp).toLocaleTimeString();
            return `
                <div class="log-entry ${level}">
                    <div><strong>[${timestamp}]</strong> ${log.message}</div>
                </div>
            `;
        }).join('');

        container.innerHTML = logsHtml;
        container.scrollTop = container.scrollHeight;
    }

    handleDataUpdate(data) {
        try {
            if (data.tokens) {
                this.displayRecentTokens(data.tokens);
            }
            if (data.trades) {
                this.displayRecentTrades(data.trades);
            }
            if (data.stats) {
                this.displayTokenStats(data.stats);
            }
            
            this.updateLastUpdate();
        } catch (error) {
            console.error('Failed to handle data update:', error);
        }
    }

    setupAutoRefresh() {
        setInterval(() => {
            this.loadSystemStatus();
            this.loadTokenStats();
            this.loadPlatformStats();
        }, 30000); // Refresh every 30 seconds
    }

    updateLastUpdate() {
        const now = new Date();
        document.getElementById('last-update').textContent = 
            `Last updated: ${now.toLocaleTimeString()}`;
    }

    formatUptime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        return `${hours}h ${minutes}m`;
    }

    formatBytes(bytes) {
        const mb = bytes / (1024 * 1024);
        return `${mb.toFixed(1)} MB`;
    }

    formatNumber(num) {
        if (num === null || num === undefined) return '0';
        if (num >= 1000000) {
            return (num / 1000000).toFixed(1) + 'M';
        }
        if (num >= 1000) {
            return (num / 1000).toFixed(1) + 'K';
        }
        return num.toLocaleString();
    }
}

// Global refresh functions
function refreshStatus() {
    window.dashboard.loadSystemStatus();
}

function refreshStats() {
    window.dashboard.loadTokenStats();
}

function refreshPlatformStats() {
    window.dashboard.loadPlatformStats();
}

function refreshTrades() {
    window.dashboard.loadRecentTrades();
}

function refreshTokens() {
    window.dashboard.loadRecentTokens();
}

function refreshLogs() {
    window.dashboard.loadLogs();
}

// Initialize dashboard when page loads
document.addEventListener('DOMContentLoaded', () => {
    window.dashboard = new PumpAgentDashboard();
}); 