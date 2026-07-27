const axios = require('axios');
const config = require('../config/env');

// Create axios instance for the external SQL database API
const externalApi = axios.create({
  baseURL: config.externalApiBaseUrl,
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
});

// ============================================================
// MOCK DATA — used when USE_MOCK_EXTERNAL_API=true
// Replace with your actual external API once configured
// ============================================================
const MOCK_CLIENTS = [
  { id: 'C001', name: 'TATA HITACHI', address: 'Dharwad, Karnataka, India' },
  { id: 'C002', name: 'CATERPILLAR INDIA', address: 'Thiruvallur, Tamil Nadu, India' },
  { id: 'C003', name: 'JCB INDIA LIMITED', address: 'Ballabgarh, Haryana, India' },
  { id: 'C004', name: 'KOMATSU INDIA', address: 'Oragadam, Tamil Nadu, India' },
  { id: 'C005', name: 'BEML LIMITED', address: 'Mysuru, Karnataka, India' },
  { id: 'C006', name: 'MARUTI SUZUKI', address: 'Manesar, Haryana, India' },
  { id: 'C007', name: 'HYUNDAI MOTORS INDIA', address: 'Sriperumbudur, Tamil Nadu, India' },
  { id: 'C008', name: 'MAHINDRA & MAHINDRA', address: 'Nashik, Maharashtra, India' },
  { id: 'C009', name: 'ASHOK LEYLAND', address: 'Chennai, Tamil Nadu, India' },
];

const MOCK_PARTS = {
  C001: [
    {
      id: 'P001', partNumber: '4004100217-0J23', clientId: 'C001',
      description: 'ASSY PROP SHAFT FRONT', revisionLevel: 'REV-04',
      vendorCode: 'RSB-V66', vendorName: 'RSB TRANSMISSIONS PVT LTD',
      jtNumber: 'JT 123 L 413', afmCode: 'AFM-2024-001',
      dealer: 'TATA HITACHI CONSTRUCTION MACHINERY',
      clientAddress: 'Dharwad, Karnataka 580001',
    },
    {
      id: 'P002', partNumber: '4004100218-0J23', clientId: 'C001',
      description: 'ASSY PROP SHAFT REAR', revisionLevel: 'REV-02',
      vendorCode: 'RSB-V67', vendorName: 'RSB TRANSMISSIONS PVT LTD',
      jtNumber: 'JT 124 L 413', afmCode: 'AFM-2024-002',
      dealer: 'TATA HITACHI CONSTRUCTION MACHINERY',
      clientAddress: 'Dharwad, Karnataka 580001',
    },
    {
      id: 'P003', partNumber: '4004100219-0J24', clientId: 'C001',
      description: 'BEARING COVER SEAL TYPE B', revisionLevel: 'REV-01',
      vendorCode: 'RSB-V68', vendorName: 'RSB TRANSMISSIONS PVT LTD',
      jtNumber: 'JT 125 L 414', afmCode: 'AFM-2024-003',
      dealer: 'TATA HITACHI CONSTRUCTION MACHINERY',
      clientAddress: 'Dharwad, Karnataka 580001',
    },
  ],
  C002: [
    {
      id: 'P004', partNumber: 'CAT-PS-4441-A', clientId: 'C002',
      description: 'PROPELLER SHAFT ASSEMBLY CAT 320', revisionLevel: 'REV-03',
      vendorCode: 'RSB-V70', vendorName: 'RSB TRANSMISSIONS PVT LTD',
      jtNumber: 'JT 200 L 500', afmCode: 'AFM-2024-010',
      dealer: 'CATERPILLAR INDIA PVT LTD',
      clientAddress: 'Thiruvallur, Tamil Nadu 600001',
    },
  ],
  C003: [
    {
      id: 'P005', partNumber: 'JCB-DRV-3CX-001', clientId: 'C003',
      description: 'DRIVE SHAFT FRONT JCB 3CX', revisionLevel: 'REV-05',
      vendorCode: 'RSB-V80', vendorName: 'RSB TRANSMISSIONS PVT LTD',
      jtNumber: 'JT 300 L 600', afmCode: 'AFM-2024-020',
      dealer: 'JCB INDIA LIMITED',
      clientAddress: 'Ballabgarh, Haryana 121004',
    },
  ],
  C009: [
    {
      id: 'P006', partNumber: 'PD601549', clientId: 'C009',
      description: 'S/F R/HSG TUBE ASSY', revisionLevel: 'NA',
      vendorCode: '7200868', vendorName: 'RSB TRANSMISSIONS PVT LTD',
      jtNumber: '590L', afmCode: 'AFM-2024-030',
      dealer: 'ASHOK LEYLAND',
      clientAddress: 'Chennai, Tamil Nadu, India',
    },
  ],
};

// ============================================================
// SERVICE METHODS
// ============================================================

/**
 * Get all clients from external API or mock data
 */
const getClients = async () => {
  if (config.useMockExternalApi) {
    return MOCK_CLIENTS;
  }
  const { data } = await externalApi.get('/clients');
  return data;
};

/**
 * Get parts by client ID
 */
const getPartsByClient = async (clientId) => {
  if (config.useMockExternalApi) {
    return MOCK_PARTS[clientId] || [];
  }
  const { data } = await externalApi.get(`/clients/${clientId}/parts`);
  return data;
};

/**
 * Get full part details by part ID
 */
const getPartDetails = async (partId) => {
  if (config.useMockExternalApi) {
    for (const parts of Object.values(MOCK_PARTS)) {
      const part = parts.find((p) => p.id === partId);
      if (part) return part;
    }
    return null;
  }
  const { data } = await externalApi.get(`/parts/${partId}`);
  return data;
};

module.exports = { getClients, getPartsByClient, getPartDetails };
