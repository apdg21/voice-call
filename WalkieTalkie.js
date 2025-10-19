// WalkieTalkie.js
import React, { useState, useEffect, useRef } from 'react';

const WalkieTalkie = ({ currentUser, contact }) => {
  const [isTalking, setIsTalking] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const audioRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const socketRef = useRef(null);

  useEffect(() => {
    // Initialize WebSocket connection
    socketRef.current = new WebSocket('wss://your-app.onrender.com');
    
    socketRef.current.onopen = () => {
      console.log('WebSocket connected');
      // Authenticate with the server
      socketRef.current.send(JSON.stringify({
        type: 'auth',
        userId: currentUser.googleId
      }));
    };

    socketRef.current.onmessage = (event) => {
      const message = JSON.parse(event.data);
      
      if (message.type === 'audio' && message.from === contact.googleId && !isMuted) {
        // Play received audio
        const audioBlob = new Blob([message.data], { type: 'audio/wav' });
        const audioUrl = URL.createObjectURL(audioBlob);
        
        if (audioRef.current) {
          audioRef.current.src = audioUrl;
          audioRef.current.play().catch(e => console.error('Error playing audio:', e));
        }
      }
    };

    return () => {
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, [currentUser, contact, isMuted]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data);
      };

      mediaRecorderRef.current.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        
        // Send audio to the contact via WebSocket
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
          const reader = new FileReader();
          reader.onload = () => {
            socketRef.current.send(JSON.stringify({
              type: 'audio',
              to: contact.googleId,
              from: currentUser.googleId,
              data: Array.from(new Uint8Array(reader.result))
            }));
          };
          reader.readAsArrayBuffer(audioBlob);
        }
      };

      mediaRecorderRef.current.start();
      setIsTalking(true);
    } catch (err) {
      console.error('Error accessing microphone:', err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      setIsTalking(false);
    }
  };

  const toggleMute = () => {
    setIsMuted(!isMuted);
  };

  return (
    <div className="walkie-talkie">
      <div className="contact-info">
        <img src={contact.imageUrl} alt={contact.name} />
        <h3>{contact.name}</h3>
      </div>
      
      <div className="controls">
        <button 
          className={`talk-button ${isTalking ? 'active' : ''}`}
          onMouseDown={startRecording}
          onMouseUp={stopRecording}
          onTouchStart={startRecording}
          onTouchEnd={stopRecording}
        >
          {isTalking ? 'Talking...' : 'Hold to Talk'}
        </button>
        
        <button 
          className={`mute-button ${isMuted ? 'muted' : ''}`}
          onClick={toggleMute}
        >
          {isMuted ? 'Unmute' : 'Mute'}
        </button>
      </div>
      
      <audio ref={audioRef} />
    </div>
  );
};

export default WalkieTalkie;
