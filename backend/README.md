# GoPrint — Sticker Printing & Packing System

Industrial-grade sticker printing software for manufacturing plants.

---

## Quick Start

### Step 1: Install PostgreSQL

Download and install PostgreSQL: https://www.postgresql.org/download/windows/

Create the database:
```sql
CREATE DATABASE rsb_printing;
```

### Step 2: Configure Environment

```cmd
cd backend
copy .env.example .env
```

Edit `.env` and set:
```
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/rsb_printing
JWT_SECRET=your_very_long_secret_key_here
```

### Step 3: Install Dependencies

```cmd
cd backend
npm install
```

### Step 4: Run Database Migration

```cmd
npm run migrate
```

This creates all tables and default users:
- **Admin**: username `admin`, password `Admin@123`
- **Operator**: username `operator`, password `Operator@123`

### Step 5: Start the Server

```cmd
npm start
```

Or for development with auto-reload:
```cmd
npm run dev
```

### Step 6: Open the Application

```
http://localhost:3000
```

---

## Default Login

| Role | Username | Password |
|------|----------|----------|
| Admin | `admin` | `Admin@123` |
| Operator | `operator` | `Operator@123` |

**Change these passwords immediately after first login!**

---

## Project Structure

```
stitch_rsb_industrial_labeling_dashboard/
├── backend/
│   ├── src/
│   │   ├── config/       # Database + env config
│   │   ├── db/           # Migrations
│   │   ├── middleware/   # Auth + error handling
│   │   ├── routes/       # API endpoints
│   │   ├── services/     # Printer, ZPL, QR services
│   │   └── server.js     # Main Express app
│   ├── .env.example
│   └── package.json
└── frontend/
    ├── pages/            # HTML pages
    │   ├── login.html
    │   ├── dashboard.html
    │   ├── printing-station.html
    │   ├── reports.html
    │   ├── printer-settings.html
    │   ├── master-registration.html
    │   └── sticker-templates.html
    └── public/
        └── js/           # Page-specific JavaScript
```

---

## API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/auth/login` | POST | Login |
| `/api/auth/me` | GET | Current user |
| `/api/clients` | GET | Get all clients |
| `/api/parts?clientId=X` | GET | Parts by client |
| `/api/parts/:id` | GET | Part details |
| `/api/printers` | GET | All printers |
| `/api/printers` | POST | Add printer |
| `/api/printers/:id` | PUT | Update printer |
| `/api/printers/:id` | DELETE | Delete printer |
| `/api/printers/:id/test` | POST | Test TCP connection |
| `/api/printers/:id/test-print` | POST | Send test label |
| `/api/print` | POST | Print sticker |
| `/api/print/preview-qr` | POST | Generate QR preview |
| `/api/logs` | GET | Print logs |
| `/api/reports/summary` | GET | Summary stats |
| `/api/reports/client-wise` | GET | Client breakdown |
| `/api/reports/printer-wise` | GET | Printer breakdown |
| `/api/reports/export/csv` | GET | Export CSV |
| `/api/reports/export/pdf` | GET | Export PDF |
| `/api/templates` | GET/POST | Templates CRUD |
| `/api/settings` | GET/PUT | App settings |
| `/api/users` | GET/POST | Users CRUD |

---

## Printer Configuration

### Honeywell PM-43 / PM42

1. Go to **Printer Settings** page
2. Click **Add Printer**
3. Enter:
   - **Printer Name**: e.g. `Honeywell PM43 - Line 1`
   - **Model**: `PM43`
   - **IP Address**: Your printer's IP (e.g. `192.168.1.104`)
   - **Port**: `9100` (standard ZPL port)
   - **Print Language**: `ZPL II`
   - **Darkness**: `25`
   - **Speed**: `6`
4. Click **Test Connection** to verify
5. Click **Test Print** to print a calibration label

### Zebra ZT411

Same setup as above — ZPL II compatible.

---

## External SQL API Integration

The application fetches clients and parts from your existing SQL database.

1. Set `EXTERNAL_API_BASE_URL` in `.env` to your SQL API URL
2. Set `USE_MOCK_EXTERNAL_API=false` to use the real API
3. Your API must support:
   - `GET /clients` → returns `[{ id, name, address }]`
   - `GET /clients/:id/parts` → returns `[{ id, partNumber, description, ... }]`
   - `GET /parts/:id` → returns full part details

While `USE_MOCK_EXTERNAL_API=true`, the system uses built-in mock data.

---

## Network Deployment

To deploy on office network:

1. Find server machine's IP: `ipconfig`
2. Allow port 3000 in Windows Firewall
3. Access from other machines: `http://192.168.X.X:3000`

---

## Troubleshooting

**Cannot connect to PostgreSQL**: Check `DATABASE_URL` in `.env`

**Printer not responding**: Verify IP/port, ensure printer is on same network

**Login fails**: Run `npm run migrate` to ensure default users are created

**QR code not showing**: Check Node.js version ≥ 18

---

## Default Credentials (CHANGE THESE!)

```
Admin:    admin / Admin@123
Operator: operator / Operator@123
```
