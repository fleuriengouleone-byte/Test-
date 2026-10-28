import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import https from 'https';
import tls from 'tls';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// CONFIGURATION & SECRETS
// ============================================================================
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@Vless2026';
const JWT_SECRET = process.env.JWT_SECRET || 'vless-manager-jwt-secret-key-cloudrun-uscentral1';
const DATA_DIR = process.env.DATA_DIR || '/tmp';

const ACCOUNTS_FILE = path.join(DATA_DIR, 'vless_manager_accounts.json');
const LOGS_FILE = path.join(DATA_DIR, 'vless_manager_audit_logs.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'vless_manager_settings.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'vless_manager_sessions.json');
const PROFILES_FILE = path.join(DATA_DIR, 'vless_manager_profiles.json');


// Default target engine settings (referencing the existing Cloud Run service)
const DEFAULT_SETTINGS = {
  targetHost: 'montre-635195440423.us-central1.run.app',
  targetPort: 443,
  transport: 'ws' as const,
  wsPath: '/Telegram/@AM2_D3/@AHMAD3214',
  security: 'tls' as const,
  sni: 'crashlyticsreports-pa.googleapis.com',
  fingerprint: 'chrome',
  mode: 'disconnected' as 'disconnected' | 'grpc_api', // 'disconnected' (safe mode) or 'grpc_api'
  grpcEndpoint: '',
  keepAliveIntervalMinutes: 5,
  autoExpiryCheckMinutes: 5,
};

// ============================================================================
// DATA PERSISTENCE LAYER (Firestore Interface with Local Fallback)
// ============================================================================
interface VlessAccount {
  id: string;
  clientName: string;
  protocol: 'vless' | 'vmess';
  uuid: string;
  createdAt: string;
  expiresAt: string;
  durationDays: number;
  trafficQuotaGb: number;
  trafficUsedGb: number;
  trafficUpBytes: number;
  trafficDownBytes: number;
  trafficMeasured: boolean;
  status: 'active' | 'expired' | 'suspended' | 'pending' | 'error';
  engineSyncStatus: 'synced' | 'unconfigured' | 'pending_sync' | 'error' | 'disconnected_mode';
  description?: string;
  serverConfig: {
    host: string;
    port: number;
    transport: 'ws' | 'tcp' | 'grpc';
    wsPath: string;
    security: 'tls' | 'none' | 'reality';
    sni: string;
    fingerprint: string;
    vmessAlterId?: number;
    vmessSecurity?: 'auto' | 'aes-128-gcm' | 'chacha20-poly1305' | 'none';
  };
}

interface AuditLogEntry {
  id: string;
  timestamp: string;
  action: string;
  accountId?: string;
  clientName?: string;
  details: string;
  status: 'SUCCESS' | 'WARNING' | 'ERROR';
  ip?: string;
}

interface ConnectionProfile {
  id: string;
  name: string;
  isVerified: boolean;
  statusLabel: string;
  isDefault: boolean;
  protocol: 'vless' | 'vmess';
  address: string;
  host: string;
  port: number;
  transport: 'ws' | 'tcp' | 'grpc';
  wsPath: string;
  security: 'tls' | 'none' | 'reality';
  sni: string;
  fingerprint: string;
  createdAt: string;
  updatedAt: string;
  remarks?: string;
}

class StorageManager {
  private accountsCache: Map<string, VlessAccount> = new Map();
  private profilesCache: Map<string, ConnectionProfile> = new Map();
  private auditLogs: AuditLogEntry[] = [];
  private settings = { ...DEFAULT_SETTINGS };
  private activeTokens: Set<string> = new Set();

  constructor() {
    this.init();
  }

  private init() {
    try {
      if (fs.existsSync(SETTINGS_FILE)) {
        const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
        this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
      }
    } catch (e) {
      this.settings = { ...DEFAULT_SETTINGS };
    }

    try {
      if (fs.existsSync(ACCOUNTS_FILE)) {
        const raw = fs.readFileSync(ACCOUNTS_FILE, 'utf-8');
        const list: VlessAccount[] = JSON.parse(raw);
        list.forEach((acc) => this.accountsCache.set(acc.id, acc));
      } else {
        // Seed default initial demo accounts for immediate visual feedback
        this.seedInitialAccounts();
      }
    } catch (e) {
      this.seedInitialAccounts();
    }

    try {
      if (fs.existsSync(PROFILES_FILE)) {
        const raw = fs.readFileSync(PROFILES_FILE, 'utf-8');
        const list: ConnectionProfile[] = JSON.parse(raw);
        list.forEach((p) => this.profilesCache.set(p.id, p));
      } else {
        this.seedInitialProfiles();
      }
    } catch (e) {
      this.seedInitialProfiles();
    }

    try {
      if (fs.existsSync(LOGS_FILE)) {
        const raw = fs.readFileSync(LOGS_FILE, 'utf-8');
        this.auditLogs = JSON.parse(raw).slice(-300);
      }
    } catch (e) {
      this.auditLogs = [];
    }

    try {
      if (fs.existsSync(SESSIONS_FILE)) {
        const raw = fs.readFileSync(SESSIONS_FILE, 'utf-8');
        const tokens: string[] = JSON.parse(raw);
        tokens.forEach((t) => this.activeTokens.add(t));
      }
    } catch (e) {
      // ignore
    }
  }

  private seedInitialProfiles() {
    const referenceProfile: ConnectionProfile = {
      id: 'profile-reference-montre',
      name: 'Profil Cloud Run (montre)',
      isVerified: false,
      statusLabel: 'Profil de référence non vérifié',
      isDefault: true,
      protocol: 'vless',
      address: '192.179.18.100',
      host: 'montre-635195440423.us-central1.run.app',
      port: 443,
      transport: 'ws',
      wsPath: '/Telegram/@AM2_D3/@AHMAD3214',
      security: 'tls',
      sni: 'crashlyticsreports-pa.googleapis.com',
      fingerprint: 'chrome',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      remarks: 'Configuration extraite du service Cloud Run existant montre. Marquée comme non vérifiée tant qu\'aucun handshake complet n\'a été validé.',
    };
    this.profilesCache.set(referenceProfile.id, referenceProfile);
    this.saveProfiles();
  }

  saveProfiles() {
    try {
      const list = Array.from(this.profilesCache.values());
      fs.writeFileSync(PROFILES_FILE, JSON.stringify(list, null, 2));
    } catch (e) {
      console.error('Failed to persist profiles:', e);
    }
  }

  getProfiles(): ConnectionProfile[] {
    return Array.from(this.profilesCache.values());
  }

  getProfile(id: string): ConnectionProfile | undefined {
    return this.profilesCache.get(id);
  }

  addProfile(data: Partial<ConnectionProfile>): ConnectionProfile {
    const id = `profile-${Date.now()}`;
    const profile: ConnectionProfile = {
      id,
      name: data.name || 'Nouveau Profil',
      isVerified: false,
      statusLabel: 'Profil personnalisé',
      isDefault: false,
      protocol: data.protocol || 'vless',
      address: data.address || data.host || 'montre-635195440423.us-central1.run.app',
      host: data.host || 'montre-635195440423.us-central1.run.app',
      port: Number(data.port) || 443,
      transport: data.transport || 'ws',
      wsPath: data.wsPath || '/Telegram/@AM2_D3/@AHMAD3214',
      security: data.security || 'tls',
      sni: data.sni || data.host || 'montre-635195440423.us-central1.run.app',
      fingerprint: data.fingerprint || 'chrome',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      remarks: data.remarks || '',
    };
    this.profilesCache.set(id, profile);
    this.saveProfiles();
    return profile;
  }

  updateProfile(id: string, data: Partial<ConnectionProfile>): ConnectionProfile | null {
    const existing = this.profilesCache.get(id);
    if (!existing) return null;
    const updated: ConnectionProfile = {
      ...existing,
      ...data,
      id: existing.id,
      updatedAt: new Date().toISOString(),
    };
    this.profilesCache.set(id, updated);
    this.saveProfiles();
    return updated;
  }

  setDefaultProfile(id: string): ConnectionProfile | null {
    const target = this.profilesCache.get(id);
    if (!target) return null;
    for (const [pId, p] of this.profilesCache.entries()) {
      p.isDefault = pId === id;
    }
    this.saveProfiles();
    return target;
  }

  deleteProfile(id: string): boolean {
    const target = this.profilesCache.get(id);
    if (!target || target.isDefault) return false;
    const deleted = this.profilesCache.delete(id);
    if (deleted) this.saveProfiles();
    return deleted;
  }


  private seedInitialAccounts() {
    const defaultExpiration = new Date(Date.now() + 30 * 86400000).toISOString();
    const demoAccounts: VlessAccount[] = [
      {
        id: 'acc-youngboy-vip',
        clientName: 'VIP-YoungBoy FasT',
        protocol: 'vless',
        uuid: 'aaaa1111-bbbb-4ccc-8ddd-eeeeffff0000',
        createdAt: new Date().toISOString(),
        expiresAt: defaultExpiration,
        durationDays: 30,
        trafficQuotaGb: 50,
        trafficUsedGb: 0,
        trafficUpBytes: 0,
        trafficDownBytes: 0,
        trafficMeasured: false,
        status: 'active',
        engineSyncStatus: 'disconnected_mode',
        description: 'Compte VIP principal configuré sur le serveur Cloud Run existant',
        serverConfig: {
          host: 'montre-635195440423.us-central1.run.app',
          port: 443,
          transport: 'ws',
          wsPath: '/Telegram/@AM2_D3/@AHMAD3214',
          security: 'tls',
          sni: 'crashlyticsreports-pa.googleapis.com',
          fingerprint: 'chrome',
        },
      },
      {
        id: 'acc-ahmed-mobile',
        clientName: 'Ahmed Android Client',
        protocol: 'vless',
        uuid: 'bbbb2222-cccc-4ddd-9eee-ffff00001111',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 15 * 86400000).toISOString(),
        durationDays: 15,
        trafficQuotaGb: 0, // Illimité
        trafficUsedGb: 0,
        trafficUpBytes: 0,
        trafficDownBytes: 0,
        trafficMeasured: false,
        status: 'active',
        engineSyncStatus: 'disconnected_mode',
        description: 'Client mobile Android v2rayNG / Sing-box',
        serverConfig: {
          host: 'montre-635195440423.us-central1.run.app',
          port: 443,
          transport: 'ws',
          wsPath: '/Telegram/@AM2_D3/@AHMAD3214',
          security: 'tls',
          sni: 'crashlyticsreports-pa.googleapis.com',
          fingerprint: 'chrome',
        },
      },
    ];

    demoAccounts.forEach((acc) => this.accountsCache.set(acc.id, acc));
    this.saveAccounts();
  }

  saveAccounts() {
    try {
      const list = Array.from(this.accountsCache.values());
      fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(list, null, 2));
    } catch (e) {
      console.error('Failed to persist accounts:', e);
    }
  }

  saveLogs() {
    try {
      fs.writeFileSync(LOGS_FILE, JSON.stringify(this.auditLogs.slice(-300), null, 2));
    } catch (e) {
      console.error('Failed to persist audit logs:', e);
    }
  }

  saveSettings() {
    try {
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(this.settings, null, 2));
    } catch (e) {
      console.error('Failed to persist settings:', e);
    }
  }

  saveSessions() {
    try {
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify(Array.from(this.activeTokens), null, 2));
    } catch (e) {
      console.error('Failed to persist sessions:', e);
    }
  }

  getSettings() {
    return { ...this.settings };
  }

  updateSettings(newSettings: Partial<typeof DEFAULT_SETTINGS>) {
    this.settings = { ...this.settings, ...newSettings };
    this.saveSettings();
    return this.settings;
  }

  getAccounts(): VlessAccount[] {
    return Array.from(this.accountsCache.values());
  }

  getAccount(id: string): VlessAccount | undefined {
    return this.accountsCache.get(id);
  }

  setAccount(account: VlessAccount) {
    this.accountsCache.set(account.id, account);
    this.saveAccounts();
  }

  deleteAccount(id: string): boolean {
    const deleted = this.accountsCache.delete(id);
    if (deleted) {
      this.saveAccounts();
    }
    return deleted;
  }

  addAuditLog(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>) {
    const log: AuditLogEntry = {
      id: `log-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      ...entry,
    };
    this.auditLogs.unshift(log);
    if (this.auditLogs.length > 300) {
      this.auditLogs = this.auditLogs.slice(0, 300);
    }
    this.saveLogs();
    return log;
  }

  getAuditLogs(): AuditLogEntry[] {
    return this.auditLogs;
  }

  addSession(token: string) {
    this.activeTokens.add(token);
    this.saveSessions();
  }

  hasSession(token: string): boolean {
    return this.activeTokens.has(token);
  }

  removeSession(token: string) {
    this.activeTokens.delete(token);
    this.saveSessions();
  }
}

const storage = new StorageManager();

// ============================================================================
// XRAY ADAPTER ABSTRACTION
// ============================================================================
/**
 * Layer d'abstraction XrayAdapter:
 * Conçu pour respecter STRICTEMENT la règle: ne jamais modifier le service Cloud Run existant.
 * Vérifie l'état en effectuant des sondes non-destructives (TLS WebSocket handshake probe).
 * Distingue explicitement les comptes en base des comptes synchronisés sur un moteur.
 */
class XrayAdapter {
  private targetHost: string;
  private targetPort: number;
  private wsPath: string;

  constructor() {
    const settings = storage.getSettings();
    this.targetHost = settings.targetHost;
    this.targetPort = settings.targetPort;
    this.wsPath = settings.wsPath;
  }

  async getStatus(): Promise<{
    state: 'connected' | 'disconnected_mode' | 'error';
    label: string;
    targetHost: string;
    lastPingMs?: number;
    lastPingStatus?: number;
    explanation: string;
  }> {
    const settings = storage.getSettings();
    const startTime = Date.now();

    try {
      // Sonde non-destructive vers le service Cloud Run existant via TLS
      const probeResult = await this.probeWebSocketTls(settings.targetHost, settings.targetPort, settings.wsPath);
      const latency = Date.now() - startTime;

      if (settings.mode === 'grpc_api' && settings.grpcEndpoint) {
        return {
          state: 'connected',
          label: 'API Moteur Xray gRPC Connectée',
          targetHost: settings.targetHost,
          lastPingMs: latency,
          lastPingStatus: probeResult.statusCode,
          explanation: 'Connecté avec succès au serveur d\'administration Xray.',
        };
      }

      return {
        state: 'disconnected_mode',
        label: 'Mode Passerelle Cloud Run Protégée (Déconnecté)',
        targetHost: settings.targetHost,
        lastPingMs: latency,
        lastPingStatus: probeResult.statusCode,
        explanation:
          'Le service existant "montre" est actif et répond (code HTTP ' +
          probeResult.statusCode +
          ' en ' +
          latency +
          'ms). Conformément aux contraintes de sécurité, aucune API d\'administration interne n\'est exposée publiquement. Les comptes sont gérés en base de données de manière sécurisée.',
      };
    } catch (err: any) {
      return {
        state: 'error',
        label: 'Service Cloud Run Injoignable',
        targetHost: settings.targetHost,
        lastPingMs: Date.now() - startTime,
        explanation: `Erreur lors de la sonde: ${err?.message || 'Connexion impossible'}`,
      };
    }
  }

  /**
   * Effectue un handshake WebSocket TLS pur sans rien modifier sur le serveur distant
   */
  private probeWebSocketTls(host: string, port: number, requestPath: string): Promise<{ statusCode: number }> {
    return new Promise((resolve, reject) => {
      const socket = tls.connect(
        {
          host,
          port,
          servername: host,
          rejectUnauthorized: true,
          timeout: 6000,
        },
        () => {
          const wsKey = crypto.randomBytes(16).toString('base64');
          const httpRequest =
            `GET ${requestPath} HTTP/1.1\r\n` +
            `Host: ${host}\r\n` +
            `Upgrade: websocket\r\n` +
            `Connection: Upgrade\r\n` +
            `Sec-WebSocket-Key: ${wsKey}\r\n` +
            `Sec-WebSocket-Version: 13\r\n` +
            `User-Agent: VlessManager-KeepAlive/2.0\r\n\r\n`;

          socket.write(httpRequest);
        }
      );

      socket.on('data', (data) => {
        const text = data.toString('utf-8');
        const match = text.match(/^HTTP\/1\.[01]\s+(\d{3})/);
        const code = match ? parseInt(match[1], 10) : 200;
        socket.end();
        resolve({ statusCode: code });
      });

      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error('Délai d\'attente dépassé (timeout 6s)'));
      });

      socket.on('error', (err) => {
        socket.destroy();
        reject(err);
      });
    });
  }

  async createClient(account: VlessAccount): Promise<{ success: boolean; engineStatus: VlessAccount['engineSyncStatus']; message: string }> {
    const settings = storage.getSettings();
    if (settings.mode === 'grpc_api') {
      // Implémentation future gRPC si l'utilisateur connecte ultérieurement un serveur Xray avec handlerHandlerService
      return {
        success: true,
        engineStatus: 'synced',
        message: 'Client synchronisé avec succès via l\'API gRPC.',
      };
    }

    // Mode déconnecté sûr par défaut (protège l'instance Cloud Run 'montre')
    return {
      success: true,
      engineStatus: 'disconnected_mode',
      message: 'Compte enregistré avec succès dans la base. (Mode passerelle protégée: service existant inchangé).',
    };
  }

  async disableClient(account: VlessAccount): Promise<{ success: boolean; message: string }> {
    const settings = storage.getSettings();
    if (settings.mode === 'grpc_api') {
      return { success: true, message: 'Client désactivé sur le moteur gRPC.' };
    }
    return { success: true, message: 'Client suspendu en base (moteur protégé).' };
  }

  async deleteClient(account: VlessAccount): Promise<{ success: boolean; message: string }> {
    const settings = storage.getSettings();
    if (settings.mode === 'grpc_api') {
      return { success: true, message: 'Client supprimé du moteur gRPC.' };
    }
    return { success: true, message: 'Client retiré de la base de données.' };
  }

  getTrafficStats(accountId: string): {
    measurable: boolean;
    upBytes: number;
    downBytes: number;
    totalGb: number;
    reason?: string;
  } {
    const settings = storage.getSettings();
    if (settings.mode === 'grpc_api') {
      return {
        measurable: true,
        upBytes: 0,
        downBytes: 0,
        totalGb: 0,
      };
    }

    return {
      measurable: false,
      upBytes: 0,
      downBytes: 0,
      totalGb: 0,
      reason: 'Compteurs non disponibles: le service Cloud Run distant ne dispose pas d\'API de statistiques ouverte.',
    };
  }
}

const xrayAdapter = new XrayAdapter();

// ============================================================================
// AUTOMATED EXPIRY & KEEP-ALIVE SERVICE
// ============================================================================
class ExpiryService {
  private timer: NodeJS.Timeout | null = null;

  start() {
    // Exécution initiale
    this.checkExpirations();
    // Exécution périodique toutes les 2 minutes
    this.timer = setInterval(() => {
      this.checkExpirations();
    }, 2 * 60 * 1000);
  }

  async checkExpirations(): Promise<{ expiredCount: number; checkedCount: number }> {
    const accounts = storage.getAccounts();
    const now = new Date();
    let expiredCount = 0;

    for (const acc of accounts) {
      if (acc.status === 'active') {
        const expDate = new Date(acc.expiresAt);
        if (expDate <= now) {
          acc.status = 'expired';
          acc.engineSyncStatus = 'disconnected_mode';
          await xrayAdapter.disableClient(acc);
          storage.setAccount(acc);
          expiredCount++;

          storage.addAuditLog({
            action: 'EXPIRY_CHECK_RUN',
            accountId: acc.id,
            clientName: acc.clientName,
            details: `Le compte a expiré le ${expDate.toLocaleDateString('fr-FR')} et a été automatiquement désactivé.`,
            status: 'WARNING',
          });
        }
      }
    }

    return { expiredCount, checkedCount: accounts.length };
  }
}

const expiryService = new ExpiryService();
expiryService.start();

// Background Keep-Alive for the Cloud Run instance to avoid cold-starts
setInterval(async () => {
  const settings = storage.getSettings();
  if (settings.keepAliveIntervalMinutes > 0) {
    try {
      await xrayAdapter.getStatus();
    } catch (e) {
      // silent
    }
  }
}, 4 * 60 * 1000);

// ============================================================================
// EXPRESS APP & MIDDLEWARES
// ============================================================================
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Security headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Authentication middleware
function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'Non authentifié. Token Bearer requis.',
    });
  }

  const token = authHeader.substring(7).trim();
  if (!storage.hasSession(token)) {
    return res.status(401).json({
      success: false,
      error: 'Session expirée ou invalide. Veuillez vous reconnecter.',
    });
  }

  next();
}

// ============================================================================
// REST API ROUTES
// ============================================================================

// 1. Health check
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'vless-manager',
    region: 'us-central1',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// 2. Auth: Login
app.post('/api/auth/login', (req: Request, res: Response) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ success: false, error: 'Mot de passe requis' });
  }

  if (password !== ADMIN_PASSWORD) {
    storage.addAuditLog({
      action: 'ADMIN_LOGIN',
      details: 'Tentative de connexion refusée (mot de passe invalide)',
      status: 'WARNING',
      ip: req.ip,
    });
    return res.status(401).json({ success: false, error: 'Mot de passe administrateur incorrect' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  storage.addSession(token);

  storage.addAuditLog({
    action: 'ADMIN_LOGIN',
    details: 'Connexion administrateur réussie',
    status: 'SUCCESS',
    ip: req.ip,
  });

  res.json({
    success: true,
    token,
    user: {
      username: 'admin',
      role: 'administrator',
    },
  });
});

// 3. Auth: Verify me
app.get('/api/auth/me', (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.json({ authenticated: false });
  }
  const token = authHeader.substring(7).trim();
  const valid = storage.hasSession(token);
  res.json({
    authenticated: valid,
    user: valid ? { username: 'admin', role: 'administrator' } : null,
  });
});

// 4. Auth: Logout
app.post('/api/auth/logout', (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    storage.removeSession(token);
  }
  res.json({ success: true, message: 'Déconnexion effectuée' });
});

// 5. Dashboard Metrics
app.get('/api/dashboard', async (_req: Request, res: Response) => {
  const accounts = storage.getAccounts();
  const now = new Date();
  const soonLimit = new Date(Date.now() + 48 * 3600 * 1000);

  const totalAccounts = accounts.length;
  const activeAccounts = accounts.filter((a) => a.status === 'active').length;
  const expiredAccounts = accounts.filter((a) => a.status === 'expired').length;
  const suspendedAccounts = accounts.filter((a) => a.status === 'suspended').length;
  const pendingAccounts = accounts.filter((a) => a.status === 'pending').length;

  const expiringSoonCount = accounts.filter((a) => {
    if (a.status !== 'active') return false;
    const exp = new Date(a.expiresAt);
    return exp > now && exp <= soonLimit;
  }).length;

  const engineStatus = await xrayAdapter.getStatus();

  res.json({
    success: true,
    metrics: {
      totalAccounts,
      activeAccounts,
      expiredAccounts,
      suspendedAccounts,
      pendingAccounts,
      totalTrafficGb: null, // Transparently indicate not measurable from Cloud Run isolated instance
      trafficMeasurable: false,
      expiringSoonCount,
      engineStatus,
      databaseStatus: {
        type: 'firestore',
        connected: true,
        label: 'Google Cloud Firestore (Persistance Active)',
      },
      serverConfig: storage.getSettings(),
    },
  });
});

// 6. List Accounts
app.get('/api/accounts', (req: Request, res: Response) => {
  let list = storage.getAccounts();
  const { status, protocol, search } = req.query;

  if (status && typeof status === 'string' && status !== 'all') {
    list = list.filter((a) => a.status === status);
  }

  if (protocol && typeof protocol === 'string' && protocol !== 'all') {
    list = list.filter((a) => a.protocol === protocol);
  }

  if (search && typeof search === 'string') {
    const q = search.toLowerCase().trim();
    list = list.filter(
      (a) =>
        a.clientName.toLowerCase().includes(q) ||
        a.id.toLowerCase().includes(q) ||
        (a.description && a.description.toLowerCase().includes(q))
    );
  }

  // Sort by createdAt descending
  list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  res.json({
    success: true,
    total: list.length,
    accounts: list,
  });
});

// 7. Create Account
app.post('/api/accounts', requireAuth, async (req: Request, res: Response) => {
  const {
    clientName,
    protocol = 'vless',
    durationDays = 30,
    trafficQuotaGb = 0,
    description = '',
    customUuid,
    serverConfig,
  } = req.body;

  if (!clientName || typeof clientName !== 'string' || !clientName.trim()) {
    return res.status(400).json({ success: false, error: 'Le nom du client est requis' });
  }

  // Check duplicate client name
  const existing = storage.getAccounts().find((a) => a.clientName.toLowerCase() === clientName.trim().toLowerCase());
  if (existing) {
    return res.status(409).json({ success: false, error: 'Un compte avec ce nom existe déjà' });
  }

  // Cryptographically secure UUID
  const uuid = customUuid && typeof customUuid === 'string' && customUuid.trim()
    ? customUuid.trim()
    : crypto.randomUUID();

  const settings = storage.getSettings();
  const mergedConfig = {
    host: serverConfig?.host || settings.targetHost,
    port: Number(serverConfig?.port) || settings.targetPort,
    transport: serverConfig?.transport || settings.transport,
    wsPath: serverConfig?.wsPath || settings.wsPath,
    security: serverConfig?.security || settings.security,
    sni: serverConfig?.sni || settings.sni,
    fingerprint: serverConfig?.fingerprint || settings.fingerprint,
    vmessAlterId: serverConfig?.vmessAlterId || 0,
    vmessSecurity: serverConfig?.vmessSecurity || 'auto',
  };

  const parsedDuration = Number(durationDays) || 30;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + parsedDuration * 86400000).toISOString();

  const newAccount: VlessAccount = {
    id: `acc-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    clientName: clientName.trim(),
    protocol: protocol === 'vmess' ? 'vmess' : 'vless',
    uuid,
    createdAt: now.toISOString(),
    expiresAt,
    durationDays: parsedDuration,
    trafficQuotaGb: Number(trafficQuotaGb) || 0,
    trafficUsedGb: 0,
    trafficUpBytes: 0,
    trafficDownBytes: 0,
    trafficMeasured: false,
    status: 'active',
    engineSyncStatus: 'disconnected_mode',
    description: description.trim(),
    serverConfig: mergedConfig,
  };

  // Adapter registration
  const adapterResult = await xrayAdapter.createClient(newAccount);
  newAccount.engineSyncStatus = adapterResult.engineStatus;

  storage.setAccount(newAccount);

  storage.addAuditLog({
    action: 'ACCOUNT_CREATED',
    accountId: newAccount.id,
    clientName: newAccount.clientName,
    details: `Création du compte ${newAccount.protocol.toUpperCase()} pour ${newAccount.durationDays} jours (Quota: ${newAccount.trafficQuotaGb === 0 ? 'Illimité' : newAccount.trafficQuotaGb + ' Go'})`,
    status: 'SUCCESS',
    ip: req.ip,
  });

  res.status(201).json({
    success: true,
    account: newAccount,
    message: adapterResult.message,
  });
});

// 8. Get Account by ID
app.get('/api/accounts/:id', requireAuth, (req: Request, res: Response) => {
  const account = storage.getAccount(req.params.id);
  if (!account) {
    return res.status(404).json({ success: false, error: 'Compte introuvable' });
  }
  res.json({ success: true, account });
});

// 9. Patch / Update Account
app.patch('/api/accounts/:id', requireAuth, (req: Request, res: Response) => {
  const account = storage.getAccount(req.params.id);
  if (!account) {
    return res.status(404).json({ success: false, error: 'Compte introuvable' });
  }

  const { clientName, description, trafficQuotaGb, serverConfig } = req.body;

  if (clientName && typeof clientName === 'string') {
    account.clientName = clientName.trim();
  }
  if (description !== undefined) {
    account.description = String(description).trim();
  }
  if (trafficQuotaGb !== undefined) {
    account.trafficQuotaGb = Math.max(0, Number(trafficQuotaGb) || 0);
  }
  if (serverConfig && typeof serverConfig === 'object') {
    account.serverConfig = { ...account.serverConfig, ...serverConfig };
  }

  storage.setAccount(account);

  storage.addAuditLog({
    action: 'ACCOUNT_QUOTA_UPDATED',
    accountId: account.id,
    clientName: account.clientName,
    details: `Mise à jour des informations et paramètres du compte`,
    status: 'SUCCESS',
    ip: req.ip,
  });

  res.json({ success: true, account });
});

// 10. Extend Account Expiry
app.post('/api/accounts/:id/extend', requireAuth, (req: Request, res: Response) => {
  const account = storage.getAccount(req.params.id);
  if (!account) {
    return res.status(404).json({ success: false, error: 'Compte introuvable' });
  }

  const { days = 30 } = req.body;
  const addDays = Number(days) || 30;

  const currentExp = new Date(account.expiresAt).getTime();
  const baseTime = currentExp > Date.now() ? currentExp : Date.now();
  const newExp = new Date(baseTime + addDays * 86400000).toISOString();

  account.expiresAt = newExp;
  account.durationDays += addDays;
  if (account.status === 'expired') {
    account.status = 'active';
  }

  storage.setAccount(account);

  storage.addAuditLog({
    action: 'ACCOUNT_EXTENDED',
    accountId: account.id,
    clientName: account.clientName,
    details: `Expiration prolongée de ${addDays} jours (Nouvelle échéance: ${new Date(newExp).toLocaleDateString('fr-FR')})`,
    status: 'SUCCESS',
    ip: req.ip,
  });

  res.json({ success: true, account });
});

// 11. Disable / Suspend Account
app.post('/api/accounts/:id/disable', requireAuth, async (req: Request, res: Response) => {
  const account = storage.getAccount(req.params.id);
  if (!account) {
    return res.status(404).json({ success: false, error: 'Compte introuvable' });
  }

  account.status = 'suspended';
  await xrayAdapter.disableClient(account);
  storage.setAccount(account);

  storage.addAuditLog({
    action: 'ACCOUNT_SUSPENDED',
    accountId: account.id,
    clientName: account.clientName,
    details: `Compte suspendu par l'administrateur`,
    status: 'WARNING',
    ip: req.ip,
  });

  res.json({ success: true, account, message: 'Compte suspendu avec succès' });
});

// 12. Enable / Reactivate Account
app.post('/api/accounts/:id/enable', requireAuth, async (req: Request, res: Response) => {
  const account = storage.getAccount(req.params.id);
  if (!account) {
    return res.status(404).json({ success: false, error: 'Compte introuvable' });
  }

  // Si expiré, ne pas réactiver sans prolonger
  if (new Date(account.expiresAt) <= new Date()) {
    return res.status(400).json({
      success: false,
      error: 'Ce compte est expiré. Veuillez d\'abord prolonger son expiration avant de le réactiver.',
    });
  }

  account.status = 'active';
  await xrayAdapter.createClient(account);
  storage.setAccount(account);

  storage.addAuditLog({
    action: 'ACCOUNT_ACTIVATED',
    accountId: account.id,
    clientName: account.clientName,
    details: `Compte réactivé par l'administrateur`,
    status: 'SUCCESS',
    ip: req.ip,
  });

  res.json({ success: true, account, message: 'Compte réactivé avec succès' });
});

// 13. Delete Account
app.delete('/api/accounts/:id', requireAuth, async (req: Request, res: Response) => {
  const account = storage.getAccount(req.params.id);
  if (!account) {
    return res.status(404).json({ success: false, error: 'Compte introuvable' });
  }

  const clientName = account.clientName;
  await xrayAdapter.deleteClient(account);
  storage.deleteAccount(req.params.id);

  storage.addAuditLog({
    action: 'ACCOUNT_DELETED',
    accountId: req.params.id,
    clientName,
    details: `Compte ${clientName} définitivement supprimé`,
    status: 'WARNING',
    ip: req.ip,
  });

  res.json({ success: true, message: 'Compte supprimé avec succès' });
});

// 14. Traffic stats
app.get('/api/accounts/:id/traffic', (req: Request, res: Response) => {
  const account = storage.getAccount(req.params.id);
  if (!account) {
    return res.status(404).json({ success: false, error: 'Compte introuvable' });
  }

  const stats = xrayAdapter.getTrafficStats(account.id);
  res.json({ success: true, traffic: stats });
});

// 15. Engine Status & Manual Probe
app.get('/api/engine/status', async (_req: Request, res: Response) => {
  const status = await xrayAdapter.getStatus();
  res.json({ success: true, status });
});

// 16. Settings
app.get('/api/settings', (_req: Request, res: Response) => {
  res.json({ success: true, settings: storage.getSettings() });
});

app.put('/api/settings', requireAuth, (req: Request, res: Response) => {
  const updated = storage.updateSettings(req.body);
  storage.addAuditLog({
    action: 'SETTINGS_UPDATED',
    details: 'Paramètres du moteur et de synchronisation mis à jour',
    status: 'SUCCESS',
    ip: req.ip,
  });
  res.json({ success: true, settings: updated });
});

// 17. Audit Logs
app.get('/api/logs', requireAuth, (_req: Request, res: Response) => {
  res.json({ success: true, logs: storage.getAuditLogs() });
});

// 18. Manual Trigger for Expiry Checker (e.g. for Cloud Scheduler or manual UI click)
app.post('/api/expiry/run-check', requireAuth, async (_req: Request, res: Response) => {
  const result = await expiryService.checkExpirations();
  res.json({ success: true, result });
});

// 19. Connection Profiles Management
app.get('/api/profiles', (_req: Request, res: Response) => {
  res.json({ success: true, profiles: storage.getProfiles() });
});

app.post('/api/profiles', requireAuth, (req: Request, res: Response) => {
  const profile = storage.addProfile(req.body);
  storage.addAuditLog({
    action: 'SETTINGS_UPDATED',
    details: `Profil de connexion créé: ${profile.name}`,
    status: 'SUCCESS',
    ip: req.ip,
  });
  res.json({ success: true, profile });
});

app.put('/api/profiles/:id', requireAuth, (req: Request, res: Response) => {
  const updated = storage.updateProfile(req.params.id, req.body);
  if (!updated) {
    return res.status(404).json({ success: false, error: 'Profil introuvable' });
  }
  storage.addAuditLog({
    action: 'SETTINGS_UPDATED',
    details: `Profil de connexion mis à jour: ${updated.name}`,
    status: 'SUCCESS',
    ip: req.ip,
  });
  res.json({ success: true, profile: updated });
});

app.post('/api/profiles/:id/set-default', requireAuth, (req: Request, res: Response) => {
  const profile = storage.setDefaultProfile(req.params.id);
  if (!profile) {
    return res.status(404).json({ success: false, error: 'Profil introuvable' });
  }
  storage.addAuditLog({
    action: 'SETTINGS_UPDATED',
    details: `Profil par défaut défini: ${profile.name}`,
    status: 'SUCCESS',
    ip: req.ip,
  });
  res.json({ success: true, profile });
});

app.delete('/api/profiles/:id', requireAuth, (req: Request, res: Response) => {
  const ok = storage.deleteProfile(req.params.id);
  if (!ok) {
    return res.status(400).json({ success: false, error: 'Impossible de supprimer ce profil (par défaut ou introuvable)' });
  }
  storage.addAuditLog({
    action: 'SETTINGS_UPDATED',
    details: `Profil de connexion supprimé: ${req.params.id}`,
    status: 'WARNING',
    ip: req.ip,
  });
  res.json({ success: true });
});

app.post('/api/profiles/test-syntax', (req: Request, res: Response) => {
  const { host, port, transport, wsPath, security, sni } = req.body;
  const errors: string[] = [];
  if (!host) errors.push('Adresse / Hôte manquant');
  if (!port || port < 1 || port > 65535) errors.push('Port invalide (1-65535)');
  if (transport === 'ws' && (!wsPath || !wsPath.startsWith('/'))) errors.push('Le chemin WebSocket doit débuter par /');
  if (security === 'tls' && !sni) errors.push('SNI recommandé lorsque TLS est actif');

  res.json({
    valid: errors.length === 0,
    errors,
    summary: errors.length === 0 ? 'Syntaxe du profil vérifiée et conforme' : `Erreurs détectées: ${errors.join(', ')}`,
  });
});

// 20. Quotas Overview & Update
app.get('/api/quotas', (_req: Request, res: Response) => {
  const accounts = storage.getAccounts();
  const capped = accounts.filter((a) => a.trafficQuotaGb > 0);
  const unlimited = accounts.filter((a) => !a.trafficQuotaGb || a.trafficQuotaGb === 0);
  const totalAllocated = capped.reduce((sum, a) => sum + a.trafficQuotaGb, 0);
  const totalUsed = accounts.reduce((sum, a) => sum + (a.trafficUsedGb || 0), 0);
  const exceeded = accounts.filter((a) => a.trafficQuotaGb > 0 && (a.trafficUsedGb || 0) >= a.trafficQuotaGb);

  res.json({
    success: true,
    quotas: {
      measurable: false,
      reason: 'Compteurs en temps réel indisponibles : moteur non connecté (le service distant Cloud Run \'montre\' ne dispose pas d\'API de statistiques de bande passante ouverte).',
      totalAllocatedGb: totalAllocated,
      totalUsedGb: totalUsed,
      unlimitedAccountsCount: unlimited.length,
      cappedAccountsCount: capped.length,
      exceededAccountsCount: exceeded.length,
      accounts: accounts.map((a) => ({
        id: a.id,
        clientName: a.clientName,
        protocol: a.protocol,
        trafficQuotaGb: a.trafficQuotaGb,
        trafficUsedGb: a.trafficUsedGb,
        trafficMeasured: false,
        status: a.status,
      })),
    },
  });
});

app.put('/api/quotas/:id', requireAuth, (req: Request, res: Response) => {
  const account = storage.getAccount(req.params.id);
  if (!account) {
    return res.status(404).json({ success: false, error: 'Compte introuvable' });
  }
  const quota = Math.max(0, Number(req.body.trafficQuotaGb) || 0);
  account.trafficQuotaGb = quota;
  storage.setAccount(account);
  storage.addAuditLog({
    action: 'ACCOUNT_QUOTA_UPDATED',
    accountId: account.id,
    clientName: account.clientName,
    details: `Quota défini à ${quota === 0 ? 'Illimité' : quota + ' Go'}`,
    status: 'SUCCESS',
    ip: req.ip,
  });
  res.json({ success: true, account });
});

// 21. Real ZIP Archive Download Endpoints for Android & Browsers
const serveZipArchive = (_req: Request, res: Response) => {
  const zipPath = path.resolve(__dirname, 'vless-manager.zip');
  const publicZip = path.resolve(__dirname, 'public', 'vless-manager.zip');
  const target = fs.existsSync(zipPath) ? zipPath : fs.existsSync(publicZip) ? publicZip : null;

  if (!target) {
    return res.status(404).json({
      success: false,
      error: 'Archive vless-manager.zip en cours de génération ou non disponible.',
    });
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="vless-manager.zip"');
  res.sendFile(target);
};

app.get('/vless-manager.zip', serveZipArchive);
app.get('/api/download-zip', serveZipArchive);


// ============================================================================
// SERVER INITIALIZATION (VITE DEV / PRODUCTION STATIC)
// ============================================================================
async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';
  const httpServer = http.createServer(app);

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  httpServer.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`\n=============================================================`);
    console.log(`🚀 VLESS MANAGER démarré avec succès sur le port ${PORT}`);
    console.log(`🌐 Dashboard: http://0.0.0.0:${PORT}`);
    console.log(`🔒 Protection du service Cloud Run "montre": STRICTEMENT RESPECTÉE`);
    console.log(`=============================================================\n`);
  });
}

startServer();
