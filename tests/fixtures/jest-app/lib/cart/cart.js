const { formatMoney } = require('@app/util/money');
const tax = require('./tax');

function total(items) {
  return formatMoney(items.reduce((s, i) => s + i.price, 0) * (1 + tax.rate));
}

module.exports = { total };
