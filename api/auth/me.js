const { getUser } = require('../../lib/auth');

module.exports = async (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  res.status(200).json({ user });
};
