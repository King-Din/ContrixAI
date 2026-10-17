
const signup = (req, res) => {
  res.status(501).json({
    success: false,
    message: "Signup is not implemented yet",
    code: "NOT_IMPLEMENTED"
  });
};

const login = (req, res) => {
  res.status(501).json({
    success: false,
    message: "Login is not implemented yet",
    code: "NOT_IMPLEMENTED"
  });
};

const logout = (req, res) => {
  res.status(501).json({
    success: false,
    message: "Logout is not implemented yet",
    code: "NOT_IMPLEMENTED"
  });
};

const forgotPassword = (req, res) => {
  res.status(501).json({
    success: false,
    message: "Password recovery is not implemented yet",
    code: "NOT_IMPLEMENTED"
  });
};

const resetPassword = (req, res) => {
  res.status(501).json({
    success: false,
    message: "Password reset is not implemented yet",
    code: "NOT_IMPLEMENTED"
  });
};

const verifyEmail = (req, res) => {
  res.status(501).json({
    success: false,
    message: "Email verification is not implemented yet",
    code: "NOT_IMPLEMENTED"
  });
};

const me = (req, res) => {
  res.status(501).json({
    success: false,
    message: "Authentication is not implemented yet",
    code: "NOT_IMPLEMENTED"
  });
};

module.exports = {
  signup,
  login,
  logout,
  forgotPassword,
  resetPassword,
  verifyEmail,
  me
};
