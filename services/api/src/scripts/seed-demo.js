import { randomUUID } from 'node:crypto';
import { pool } from '../config/database.js';

const DEMO_NAME = 'SmartPark Demonstration Garage';

async function seed() {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [existingLots] = await connection.execute('SELECT id FROM parking_lots WHERE name = ? LIMIT 1', [DEMO_NAME]);
    let lotId = existingLots[0]?.id;
    if (!lotId) {
      lotId = randomUUID();
      await connection.execute(`
        INSERT INTO parking_lots
          (id, owner_user_id, name, description, address_line, city, region, postal_code, country_code,
           latitude, longitude, timezone, currency, opening_time, closing_time, facility_status)
        VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
      `, [lotId, DEMO_NAME, 'Local development fixture for testing facility discovery, inventory and occupancy. Replace these details before any public deployment.',
        'Demo Site — replace before deployment', 'Bengaluru', 'Karnataka', '560001', 'IN', 12.9716, 77.5946, 'Asia/Kolkata', 'INR', '06:00:00', '23:00:00']);
    }

    const zoneIds = {};
    for (const [name, level] of [['A Zone', 'Ground floor'], ['B Zone', 'Ground floor'], ['C Zone', 'First floor']]) {
      const [rows] = await connection.execute('SELECT id FROM parking_zones WHERE parking_lot_id = ? AND name = ? LIMIT 1', [lotId, name]);
      zoneIds[name] = rows[0]?.id ?? randomUUID();
      if (!rows.length) {
        await connection.execute('INSERT INTO parking_zones (id, parking_lot_id, name, level_label) VALUES (?, ?, ?, ?)', [zoneIds[name], lotId, name, level]);
      }
    }

    const slots = [];
    for (const [prefix, zone] of [['A', 'A Zone'], ['B', 'B Zone'], ['C', 'C Zone']]) {
      for (let index = 1; index <= 5; index += 1) {
        slots.push({ code: `${prefix}-${String(index).padStart(2, '0')}`, zoneId: zoneIds[zone], state: index === 1 || (prefix === 'B' && index === 3) ? 'occupied' : index === 5 ? 'unknown' : 'empty' });
      }
    }
    for (const slot of slots) {
      const [existing] = await connection.execute('SELECT id FROM parking_slots WHERE parking_lot_id = ? AND slot_code = ? LIMIT 1', [lotId, slot.code]);
      if (existing.length) continue;
      await connection.execute(`
        INSERT INTO parking_slots
          (id, parking_lot_id, zone_id, slot_code, vehicle_type, covered, \`accessible\`, operational_status, physical_state, physical_state_updated_at)
        VALUES (?, ?, ?, ?, 'car', ?, ?, 'open', ?, UTC_TIMESTAMP(3))
      `, [randomUUID(), lotId, slot.zoneId, slot.code, slot.code.endsWith('01'), slot.code.endsWith('02'), slot.state]);
    }

    const [priceRows] = await connection.execute(
      "SELECT id FROM pricing_rules WHERE parking_lot_id = ? AND rate_type = 'hourly' AND is_active = TRUE LIMIT 1",
      [lotId]
    );
    if (!priceRows.length) {
      await connection.execute(`
        INSERT INTO pricing_rules (id, parking_lot_id, rate_type, amount, currency, service_fee, tax_rate_percent, is_active)
        VALUES (?, ?, 'hourly', 40.00, 'INR', 5.00, 0.00, TRUE)
      `, [randomUUID(), lotId]);
    }

    await connection.commit();
    console.log(`Demo facility ready: ${DEMO_NAME} (${lotId})`);
    console.log('This is test data only. Edit or remove the demo facility before production deployment.');
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
    await pool.end();
  }
}

seed().catch((error) => {
  console.error('Could not seed SmartPark demo data:', error.code ?? error.message);
  process.exitCode = 1;
});
