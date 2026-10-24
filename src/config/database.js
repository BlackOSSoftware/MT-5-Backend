import mongoose from 'mongoose';
import dns from 'node:dns';

function configureDnsServers() {
  const configured = process.env.DNS_SERVERS;
  const current = dns.getServers();
  const onlyLoopback =
    current.length > 0 &&
    current.every((s) => s === '127.0.0.1' || s === '::1');

  // Prefer explicit env; otherwise bypass broken local DNS (common Windows/Docker setup)
  const servers = (configured || (onlyLoopback ? '8.8.8.8,1.1.1.1' : ''))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (!servers.length) return;

  try {
    dns.setServers(servers);
    console.log('DNS servers configured for Node:', servers.join(', '));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('Failed to configure DNS servers:', message);
  }
}

export async function connectDB() {
  const uri = process.env.MONGO_URI;

  if (!uri) {
    console.error('MongoDB connection failed: MONGO_URI is missing in .env');
    process.exit(1);
  }

  try {
    configureDnsServers();

    await mongoose.connect(uri, {
      maxPoolSize: 50,
      minPoolSize: 5,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    console.log('MongoDB connected');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('MongoDB connection failed', message);
    process.exit(1);
  }
}
