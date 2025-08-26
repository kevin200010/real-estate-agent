// Base URL for backend API requests. Adjust the port if your FastAPI server
// runs elsewhere.
window.API_BASE_URL = 'http://localhost:8000';

// Amazon Cognito configuration used by AWS Amplify
window.COGNITO_REGION = 'us-east-1';
window.COGNITO_USER_POOL_ID = 'YOUR_USER_POOL_ID';
window.COGNITO_APP_CLIENT_ID = 'YOUR_APP_CLIENT_ID';

// Google Maps JavaScript API key. If provided, the frontend will load
// Google Maps instead of the default OpenStreetMap/Leaflet layer.
// Replace 'YOUR_API_KEY_HERE' with a valid key and copy this file to
// `config.js`.
window.GOOGLE_MAPS_API_KEY = 'YOUR_API_KEY_HERE';
