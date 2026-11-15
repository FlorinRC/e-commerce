const express = require("express");
const router = express.Router();

// Coș stocat în memorie per sesiune (în producție s-ar folosi Redis/DB)
let carts = {};

router.post("/:sessionId/add", (req, res) => {
  const { sessionId } = req.params;
  const { productId, name, price, qty = 1 } = req.body;
  if (!carts[sessionId]) carts[sessionId] = [];
  const existing = carts[sessionId].find(i => i.productId === productId);
  if (existing) existing.qty += qty;
  else carts[sessionId].push({ productId, name, price, qty });
  res.json(carts[sessionId]);
});

router.get("/:sessionId", (req, res) => {
  res.json(carts[req.params.sessionId] || []);
});

router.delete("/:sessionId/remove/:productId", (req, res) => {
  const { sessionId, productId } = req.params;
  if (carts[sessionId]) {
    carts[sessionId] = carts[sessionId].filter(i => i.productId !== parseInt(productId));
  }
  res.json(carts[sessionId] || []);
});

router.delete("/:sessionId", (req, res) => {
  delete carts[req.params.sessionId];
  res.json({ message: "Coș golit" });
});

module.exports = router;
