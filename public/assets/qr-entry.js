import QRCode from 'qrcode';
export const createQR=(url)=>QRCode.toDataURL(url,{width:1000,margin:4,errorCorrectionLevel:'M',color:{dark:'#163b24',light:'#ffffff'}});
