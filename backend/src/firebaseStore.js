import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

function getFirebaseCredentials() {
  const projectId = process.env.FIREBASE_PROJECT_ID || "";
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL || "";
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

  if (projectId && clientEmail && privateKey) {
    return { projectId, clientEmail, privateKey };
  }

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "";
  if (serviceAccountJson) {
    try {
      const parsed = JSON.parse(serviceAccountJson);
      if (parsed.project_id && parsed.client_email && parsed.private_key) {
        return {
          projectId: parsed.project_id,
          clientEmail: parsed.client_email,
          privateKey: parsed.private_key
        };
      }
    } catch (error) {
      throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON");
    }
  }

  return null;
}

class FirebaseStore {
  constructor() {
    this.enabled = false;
    this.db = null;
    this.writeErrors = 0;
    this.writes = 0;
    this.init();
  }

  init() {
    try {
      const credentials = getFirebaseCredentials();
      if (!credentials) return;
      const app = getApps()[0] || initializeApp({ credential: cert(credentials) });
      this.db = getFirestore(app);
      this.enabled = true;
    } catch (error) {
      this.writeErrors += 1;
      console.error("Firebase initialization failed:", error.message);
    }
  }

  async write(collection, id, data, merge = true) {
    if (!this.enabled || !this.db) return false;
    try {
      await this.db.collection(collection).doc(id).set({
        ...data,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge });
      this.writes += 1;
      return true;
    } catch (error) {
      this.writeErrors += 1;
      console.error("Firebase write failed:", error.message);
      return false;
    }
  }

  async recordSignal(signal) {
    return this.write("signals", signal.id, signal, false);
  }

  async recordSignalOutcome(id, outcome) {
    return this.write("signals", id, {
      outcome,
      outcomeRecordedAt: FieldValue.serverTimestamp()
    }, true);
  }

  async recordPaperTrade(trade) {
    const id = String(trade.id || trade.symbol + "-" + (trade.timestamp || Date.now()));
    return this.write("paperTrades", id, { ...trade, id }, false);
  }

  async writeDailySummary(date, summary) {
    return this.write("dailyStats", date, summary, true);
  }

  snapshot() {
    return {
      enabled: this.enabled,
      writes: this.writes,
      writeErrors: this.writeErrors
    };
  }
}

export { FirebaseStore };