(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.XiangqiRepetition = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function evaluate(resultKey, givesCheck, keyHistory) {
    const occurrences = keyHistory.filter(item => item === resultKey).length;
    if (givesCheck && occurrences >= 1) return '禁止重复将军，请选择其他走法';
    if (occurrences >= 2) return '禁止三次重复局面，请选择其他走法';
    return null;
  }
  return { evaluate };
});
