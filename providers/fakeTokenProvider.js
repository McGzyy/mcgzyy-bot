const { getFakeTokenData } = require('../utils/fakeTokenData');

function fetchFakeTokenData(contractAddress = null) {
  return getFakeTokenData(contractAddress);
}

module.exports = { fetchFakeTokenData };