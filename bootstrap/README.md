# Whisper DHT Bootstrap Node

This is a persistent DHT node that helps Whisper clients discover each other.

## Requirements

- Node.js 18+
- Public IP address (for production)
- Port 4001 open (default, configurable)

## Local Testing
```bash
# Start bootstrap node
node bootstrap/dht-node.js

# Note the multiaddr output, example:
# /ip4/192.168.1.100/tcp/4001/p2p/12D3KooW...
```

## Production Deployment

### Option 1: VPS (DigitalOcean, AWS, etc.)
```bash
# 1. SSH to your VPS
ssh user@your-vps-ip

# 2. Install Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# 3. Clone repository
git clone <your-repo>
cd whisper-mailbox

# 4. Install dependencies
npm install

# 5. Start with PM2 (process manager)
npm install -g pm2
pm2 start bootstrap/dht-node.js --name whisper-dht
pm2 save
pm2 startup
```

### Option 2: Docker
```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm install --production

COPY bootstrap/ ./bootstrap/
COPY lib/ ./lib/

EXPOSE 4001

CMD ["node", "bootstrap/dht-node.js"]
```
```bash
# Build and run
docker build -t whisper-dht-bootstrap .
docker run -d -p 4001:4001 --name whisper-bootstrap whisper-dht-bootstrap
```

## Configuration

Environment variables:

- `DHT_PORT` - Port to listen on (default: 4001)
- `DHT_HOST` - Host to bind to (default: 0.0.0.0)
- `PEER_ID_FILE` - Path to peer ID file (default: ./bootstrap/peer-id.json)

Example:
```bash
DHT_PORT=5001 node bootstrap/dht-node.js
```

## Using Bootstrap Nodes in Clients

Once you have a bootstrap node running, update your client code:
```javascript
// In dht-provider.js
const bootstrapNodes = [
  '/ip4/YOUR_VPS_IP/tcp/4001/p2p/12D3KooW...',
  '/ip4/ANOTHER_VPS_IP/tcp/4001/p2p/12D3KooW...'
];

delivery.addProvider(new DHTProvider({
  priority: 1,
  enabled: true,
  bootstrapNodes: bootstrapNodes
}));
```

## Monitoring
```bash
# View logs (PM2)
pm2 logs whisper-dht

# View logs (Docker)
docker logs -f whisper-bootstrap

# Check status
pm2 status
```

## Recommended Setup

For production, run **3-5 bootstrap nodes** in different locations:

1. **Europe** (e.g., Frankfurt, Amsterdam)
2. **US East** (e.g., New York)
3. **US West** (e.g., San Francisco)
4. **Asia** (e.g., Singapore)
5. **Backup** (any region)

Cost: ~5€/month per node = 15-25€/month total

## Security

- Bootstrap nodes don't store messages (only routing info)
- No private data passes through them
- They just help peers find each other
- Open source and auditable

## Troubleshooting

**"Port already in use"**
```bash
# Change port
DHT_PORT=5001 node bootstrap/dht-node.js
```

**"No connections after 5 minutes"**
- Check firewall rules (port 4001 must be open)
- Verify public IP is accessible
- Check NAT configuration

**"Peer ID keeps changing"**
- Ensure PEER_ID_FILE path is writable
- Check file permissions
- Verify persistent storage (not tmpfs)
