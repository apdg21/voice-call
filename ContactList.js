// ContactList.js
import React, { useState, useEffect } from 'react';
import { GoogleLogin } from 'react-google-login';

const ContactList = ({ user, setSelectedContact }) => {
  const [contacts, setContacts] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    // Fetch contacts from backend
    const fetchContacts = async () => {
      try {
        const response = await fetch(`/api/contacts/${user.googleId}`);
        const data = await response.json();
        setContacts(data);
      } catch (error) {
        console.error('Error fetching contacts:', error);
      }
    };

    if (user) {
      fetchContacts();
    }
  }, [user]);

  const addContact = (contact) => {
    // Add contact to backend
    fetch('/api/contacts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId: user.googleId,
        contact: contact
      }),
    })
    .then(response => response.json())
    .then(data => {
      setContacts([...contacts, data]);
    })
    .catch(error => console.error('Error adding contact:', error));
  };

  const filteredContacts = contacts.filter(contact =>
    contact.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="contact-list">
      <h2>Contacts</h2>
      <div className="search">
        <input
          type="text"
          placeholder="Search contacts..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>
      
      <div className="contact-items">
        {filteredContacts.map(contact => (
          <div 
            key={contact.googleId} 
            className="contact-item"
            onClick={() => setSelectedContact(contact)}
          >
            <img src={contact.imageUrl} alt={contact.name} />
            <span>{contact.name}</span>
          </div>
        ))}
      </div>
      
      <div className="add-contact">
        <h3>Add Contact</h3>
        <GoogleLogin
          clientId="YOUR_GOOGLE_CLIENT_ID"
          buttonText="Add Google Contact"
          onSuccess={(response) => addContact(response.profileObj)}
          cookiePolicy={'single_host_origin'}
        />
      </div>
    </div>
  );
};

export default ContactList;
