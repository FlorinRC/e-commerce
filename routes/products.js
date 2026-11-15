const express = require("express");
const router = express.Router();
const products = require("../data/products");

// GET toate produsele
router.get("/", (req, res) => {
  const { category } = req.query;
  if (category) {
    const filtered = products.filter(
      (p) => p.category.toLowerCase() === category.toLowerCase()
    );
    return res.json(filtered);
  }
  res.json(products);
});

// GET un produs după ID
router.get("/:id", (req, res) => {
  const product = products.find((p) => p.id === parseInt(req.params.id));
  if (!product) return res.status(404).json({ error: "Produs negăsit" });
  res.json(product);
});

module.exports = router;
