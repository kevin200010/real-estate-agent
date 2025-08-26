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

// Google Calendar API configuration. The leads page can display events from a
// public Google Calendar when these values are provided. Copy this file to
// `config.js` and replace with your own API key and calendar ID.
window.GOOGLE_CALENDAR_API_KEY = 'YOUR_CALENDAR_API_KEY';
window.GOOGLE_CALENDAR_ID = 'YOUR_CALENDAR_ID';
// Optional OAuth access token for loading a user's private calendar.
// If set, the app will read events from that user's primary calendar.
window.GOOGLE_CALENDAR_ACCESS_TOKEN = '';

// Client ID for Google Identity Services, used to authorize access to a user's
// Google Calendar. Provide this if you want users to sign in and sync their
// personal calendars.
window.GOOGLE_CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID';

// Redirect URI registered for the OAuth client. By default the application
// uses its current origin, but you can override this if your Google Cloud
// console specifies a different authorized redirect URI.
window.GOOGLE_REDIRECT_URI = '';
