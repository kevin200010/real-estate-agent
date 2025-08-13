document.addEventListener('DOMContentLoaded', () => {
  const signinForm = document.getElementById('signin-form');
  if (signinForm) {
    signinForm.addEventListener('submit', e => {
      e.preventDefault();
      const stored = JSON.parse(localStorage.getItem('user') || '{}');
      const { username, password } = signinForm;
      if (username.value === stored.username && password.value === stored.password) {
        localStorage.setItem('loggedIn', 'true');
        window.location.href = 'index.html';
      } else {
        alert('Invalid credentials');
      }
    });
  }

  const signupForm = document.getElementById('signup-form');
  if (signupForm) {
    signupForm.addEventListener('submit', e => {
      e.preventDefault();
      const { username, password } = signupForm;
      localStorage.setItem('user', JSON.stringify({ username: username.value, password: password.value }));
      localStorage.setItem('loggedIn', 'true');
      window.location.href = 'index.html';
    });
  }
});
