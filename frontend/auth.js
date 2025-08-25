document.addEventListener('DOMContentLoaded', () => {
  const { Amplify, Auth } = aws_amplify;
  Amplify.configure({
    Auth: {
      region: window.COGNITO_REGION,
      userPoolId: window.COGNITO_USER_POOL_ID,
      userPoolWebClientId: window.COGNITO_APP_CLIENT_ID,
    }
  });

  const signinForm = document.getElementById('signin-form');
  if (signinForm) {
    signinForm.addEventListener('submit', async e => {
      e.preventDefault();
      const { username, password } = signinForm;
      try {
        await Auth.signIn(username.value, password.value);
        window.location.href = 'index.html';
      } catch (err) {
        alert('Invalid credentials');
      }
    });

    const forgotLink = document.getElementById('forgot-password-link');
    if (forgotLink) {
      forgotLink.addEventListener('click', async e => {
        e.preventDefault();
        const username = prompt('Enter your username');
        if (!username) return;
        try {
          await Auth.forgotPassword(username);
          const code = prompt('Enter the verification code sent to your email');
          const newPassword = prompt('Enter your new password');
          if (!code || !newPassword) return;
          await Auth.forgotPasswordSubmit(username, code, newPassword);
          alert('Password has been reset. You can now sign in with your new password.');
        } catch {
          alert('Unable to reset password.');
        }
      });
    }
  }

  const signupForm = document.getElementById('signup-form');
  if (signupForm) {
    const passwordInput = signupForm.password;
    const hint = document.getElementById('password-hint');
    if (passwordInput && hint) {
      passwordInput.addEventListener('input', () => {
        const pwd = passwordInput.value;
        const valid = /^(?=.*\d).{8,}$/.test(pwd);
        hint.textContent = valid
          ? 'Password looks good'
          : 'Password must be at least 8 characters and include a number';
        hint.style.color = valid ? 'green' : 'red';
      });
    }
    signupForm.addEventListener('submit', async e => {
      e.preventDefault();
      const { username, password } = signupForm;
      try {
        await Auth.signUp({ username: username.value, password: password.value });
        window.location.href = 'signin.html';
      } catch (err) {
        alert('Sign up failed');
      }
    });
  }

  window.signOut = async () => {
    try {
      await Auth.signOut();
    } catch (_) {}
    window.location.href = 'signin.html';
  };
});
