export const supportedLanguages = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'हिन्दी' },
  { value: 'kn', label: 'ಕನ್ನಡ' },
  { value: 'te', label: 'తెలుగు' }
];

const translations = {
  en: {},
  hi: {
    'WORKSPACE':'कार्यस्थल','MANAGE':'प्रबंधन','ADMINISTRATION':'प्रशासन','PREFERENCES':'प्राथमिकताएँ',
    'Overview':'अवलोकन','Find parking':'पार्किंग खोजें','My bookings':'मेरी बुकिंग','Vehicles':'वाहन','Saved & reviews':'सेव किए गए और समीक्षाएँ','Refer & earn':'रेफ़र करें और कमाएँ','Monthly passes':'मासिक पास','Corporate & EV':'कॉर्पोरेट और ईवी',
    'Parking spaces':'पार्किंग स्थान','My listings':'मेरी लिस्टिंग','Owner verification':'मालिक सत्यापन','Owner earnings':'मालिक की कमाई','Camera detection':'कैमरा पहचान','Plate recognition':'नंबर प्लेट पहचान','Operations':'संचालन','Finance review':'वित्त समीक्षा','Transactions':'लेन-देन','Gate access':'गेट प्रवेश','Admin console':'एडमिन कंसोल','User management':'उपयोगकर्ता प्रबंधन','Promotions':'ऑफ़र','Notifications':'सूचनाएँ','Settings':'सेटिंग्स','Help & support':'सहायता और समर्थन','My profile':'मेरी प्रोफ़ाइल',
    'YOUR PARKING OVERVIEW':'आपकी पार्किंग का अवलोकन','Find a parking spot':'पार्किंग स्थान खोजें','Active locations':'सक्रिय स्थान','Total spaces':'कुल स्थान','Published facilities':'प्रकाशित सुविधाएँ','Across active locations':'सभी सक्रिय स्थानों में','Sign out':'साइन आउट','Need a hand?':'मदद चाहिए?','Visit help center':'सहायता केंद्र खोलें'
  },
  kn: {
    'WORKSPACE':'ಕಾರ್ಯಸ್ಥಳ','MANAGE':'ನಿರ್ವಹಣೆ','ADMINISTRATION':'ಆಡಳಿತ','PREFERENCES':'ಆದ್ಯತೆಗಳು',
    'Overview':'ಅವಲೋಕನ','Find parking':'ಪಾರ್ಕಿಂಗ್ ಹುಡುಕಿ','My bookings':'ನನ್ನ ಬುಕ್ಕಿಂಗ್‌ಗಳು','Vehicles':'ವಾಹನಗಳು','Saved & reviews':'ಉಳಿಸಿದವು ಮತ್ತು ವಿಮರ್ಶೆಗಳು','Refer & earn':'ರೆಫರ್ ಮಾಡಿ ಗಳಿಸಿ','Monthly passes':'ಮಾಸಿಕ ಪಾಸ್‌ಗಳು','Corporate & EV':'ಕಾರ್ಪೊರೇಟ್ ಮತ್ತು EV',
    'Parking spaces':'ಪಾರ್ಕಿಂಗ್ ಸ್ಥಳಗಳು','My listings':'ನನ್ನ ಪಟ್ಟಿಗಳು','Owner verification':'ಮಾಲೀಕರ ಪರಿಶೀಲನೆ','Owner earnings':'ಮಾಲೀಕರ ಆದಾಯ','Camera detection':'ಕ್ಯಾಮೆರಾ ಪತ್ತೆ','Plate recognition':'ನಂಬರ್ ಪ್ಲೇಟ್ ಗುರುತಿಸುವಿಕೆ','Operations':'ಕಾರ್ಯಾಚರಣೆಗಳು','Finance review':'ಹಣಕಾಸು ಪರಿಶೀಲನೆ','Transactions':'ವಹಿವಾಟುಗಳು','Gate access':'ಗೇಟ್ ಪ್ರವೇಶ','Admin console':'ನಿರ್ವಾಹಕ ಕನ್ಸೋಲ್','User management':'ಬಳಕೆದಾರ ನಿರ್ವಹಣೆ','Promotions':'ಪ್ರಚಾರಗಳು','Notifications':'ಅಧಿಸೂಚನೆಗಳು','Settings':'ಸೆಟ್ಟಿಂಗ್‌ಗಳು','Help & support':'ಸಹಾಯ ಮತ್ತು ಬೆಂಬಲ','My profile':'ನನ್ನ ಪ್ರೊಫೈಲ್',
    'YOUR PARKING OVERVIEW':'ನಿಮ್ಮ ಪಾರ್ಕಿಂಗ್ ಅವಲೋಕನ','Find a parking spot':'ಪಾರ್ಕಿಂಗ್ ಸ್ಥಳ ಹುಡುಕಿ','Active locations':'ಸಕ್ರಿಯ ಸ್ಥಳಗಳು','Total spaces':'ಒಟ್ಟು ಸ್ಥಳಗಳು','Published facilities':'ಪ್ರಕಟಿತ ಸೌಲಭ್ಯಗಳು','Across active locations':'ಎಲ್ಲಾ ಸಕ್ರಿಯ ಸ್ಥಳಗಳಲ್ಲಿ','Sign out':'ಸೈನ್ ಔಟ್','Need a hand?':'ಸಹಾಯ ಬೇಕೇ?','Visit help center':'ಸಹಾಯ ಕೇಂದ್ರ ತೆರೆಯಿರಿ'
  },
  te: {
    'WORKSPACE':'పని స్థలం','MANAGE':'నిర్వహణ','ADMINISTRATION':'పరిపాలన','PREFERENCES':'ప్రాధాన్యతలు',
    'Overview':'సారాంశం','Find parking':'పార్కింగ్ వెతకండి','My bookings':'నా బుకింగ్‌లు','Vehicles':'వాహనాలు','Saved & reviews':'సేవ్ చేసినవి & సమీక్షలు','Refer & earn':'రిఫర్ చేసి సంపాదించండి','Monthly passes':'నెలవారీ పాస్‌లు','Corporate & EV':'కార్పొరేట్ & EV',
    'Parking spaces':'పార్కింగ్ స్థలాలు','My listings':'నా జాబితాలు','Owner verification':'యజమాని ధృవీకరణ','Owner earnings':'యజమాని ఆదాయం','Camera detection':'కెమెరా గుర్తింపు','Plate recognition':'నంబర్ ప్లేట్ గుర్తింపు','Operations':'కార్యకలాపాలు','Finance review':'ఆర్థిక సమీక్ష','Transactions':'లావాదేవీలు','Gate access':'గేట్ ప్రవేశం','Admin console':'అడ్మిన్ కన్సోల్','User management':'వినియోగదారు నిర్వహణ','Promotions':'ప్రమోషన్లు','Notifications':'నోటిఫికేషన్లు','Settings':'సెట్టింగ్‌లు','Help & support':'సహాయం & మద్దతు','My profile':'నా ప్రొఫైల్',
    'YOUR PARKING OVERVIEW':'మీ పార్కింగ్ అవలోకనం','Find a parking spot':'పార్కింగ్ స్థలం వెతకండి','Active locations':'క్రియాశీల ప్రదేశాలు','Total spaces':'మొత్తం స్థలాలు','Published facilities':'ప్రచురించిన సదుపాయాలు','Across active locations':'అన్ని క్రియాశీల ప్రదేశాల్లో','Sign out':'సైన్ అవుట్','Need a hand?':'సహాయం కావాలా?','Visit help center':'సహాయ కేంద్రం తెరవండి'
  }
};

export function translate(language, text) {
  return translations[language]?.[text] || text;
}
