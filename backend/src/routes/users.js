const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

// GET /api/users
router.get('/', authenticate, requireRole('Admin', 'Supervisor'), async (req, res, next) => {
  try {
    const result = await db.query(
      'SELECT id, name, email, username, role, is_active, created_at FROM users ORDER BY created_at DESC'
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { next(err); }
});

// POST /api/users
router.post('/', authenticate, requireRole('Admin'), async (req, res, next) => {
  try {
    const { name, email, username, password, role } = req.body;
    if (!name || !username || !password) {
      return res.status(400).json({ success: false, message: 'Name, username, and password are required.' });
    }
    const validRoles = ['Admin', 'Supervisor', 'Operator'];
    if (role && !validRoles.includes(role)) {
      return res.status(400).json({ success: false, message: `Role must be one of: ${validRoles.join(', ')}.` });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await db.query(
      `INSERT INTO users (name, email, username, password, role) VALUES ($1,$2,$3,$4,$5)
       RETURNING id, name, email, username, role, created_at`,
      [name, email || null, username.toLowerCase().trim(), hashedPassword, role || 'Operator']
    );
    res.status(201).json({ success: true, data: result.rows[0], message: 'User created.' });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ success: false, message: 'Username or email already exists.' });
    }
    next(err);
  }
});

// PUT /api/users/:id
router.put('/:id', authenticate, requireRole('Admin'), async (req, res, next) => {
  try {
    const { name, email, role, is_active, password } = req.body;
    let hashedPassword = undefined;
    if (password) hashedPassword = await bcrypt.hash(password, 10);

    const result = await db.query(
      `UPDATE users SET
         name = COALESCE($1, name),
         email = COALESCE($2, email),
         role = COALESCE($3, role),
         is_active = COALESCE($4, is_active),
         password = COALESCE($5, password),
         updated_at = NOW()
       WHERE id = $6
       RETURNING id, name, email, username, role, is_active`,
      [name, email, role, is_active, hashedPassword, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ success: false, message: 'User not found.' });
    res.json({ success: true, data: result.rows[0], message: 'User updated.' });
  } catch (err) { next(err); }
});

// DELETE /api/users/:id — deactivate only
router.delete('/:id', authenticate, requireRole('Admin'), async (req, res, next) => {
  try {
    if (parseInt(req.params.id) === req.user.id) {
      return res.status(400).json({ success: false, message: 'Cannot deactivate your own account.' });
    }
    const result = await db.query(
      'UPDATE users SET is_active = FALSE WHERE id = $1 RETURNING name',
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ success: false, message: 'User not found.' });
    res.json({ success: true, message: `User "${result.rows[0].name}" deactivated.` });
  } catch (err) { next(err); }
});

module.exports = router;
