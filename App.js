// App.js
import React, { useState, useEffect } from 'react';
import { GoogleLogin, GoogleLogout } from 'react-google-login';
import { gapi } from 'gapi-script';
import ContactList from './components/ContactList';
import WalkieTalkie from './components/WalkieTalkie';

const CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID';

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState(null);
  const [selectedContact, setSelectedContact] = useState(null);

  useEffect(() => {
    const start = () => {
      gapi.client.init({
        clientId: CLIENT_ID,
        scope: 'email profile',
      });
    };
    gapi.load('client:auth2', start);
  }, []);

  const onSuccess = (res) => {
    setUser(res.profileObj);
    setIsLoggedIn(true);
  };

  const onFailure = (err) => {
    console.log('failed', err);
  };

  const onLogout = () => {
    setUser(null);
    setIsLoggedIn(false);
    setSelectedContact(null);
  };

  return (
    <div className="App">
      <h1>Walkie Talkie App</h1>
      {!isLoggedIn ? (
        <GoogleLogin
          clientId={CLIENT_ID}
          buttonText="Login with Google"
          onSuccess={onSuccess}
          onFailure={onFailure}
          cookiePolicy={'single_host_origin'}
        />
      ) : (
        <div>
          <div className="user-info">
            <img src={user.imageUrl} alt={user.name} />
            <h3>{user.name}</h3>
            <GoogleLogout
              clientId={CLIENT_ID}
              buttonText="Logout"
              onLogoutSuccess={onLogout}
            />
          </div>
          
          <div className="app-content">
            <ContactList 
              user={user} 
              setSelectedContact={setSelectedContact}
            />
            
            {selectedContact && (
              <WalkieTalkie 
                currentUser={user}
                contact={selectedContact}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
