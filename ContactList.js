// In ContactList.js, update the addContact function:
const addContact = async (contact) => {
  try {
    // First, ensure current user exists
    await fetch('/api/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(user)
    });

    // Then add the contact
    const response = await fetch('/api/contacts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId: user.googleId,
        contact: contact
      }),
    });
    
    if (!response.ok) throw new Error('Failed to add contact');
    
    const newContact = await response.json();
    setContacts(prevContacts => [...prevContacts, newContact]);
  } catch (error) {
    console.error('Error adding contact:', error);
  }
};
