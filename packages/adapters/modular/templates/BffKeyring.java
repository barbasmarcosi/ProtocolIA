package dev.protocolia.modular;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/** Versioned BFF AES-256-GCM with retired keys that decrypt but never encrypt. */
final class BffKeyring {
  private record Key(String tag,SecretKeySpec aes){}
  private final List<Key> keys;
  private final SecureRandom random=new SecureRandom();
  private static Key parse(String hex) {
    if(hex==null||!hex.matches("[a-fA-F0-9]{64}"))
      throw new IllegalStateException("BFF keys must be exactly 32 hex bytes");
    byte[] bytes=HexFormat.of().parseHex(hex);
    try {
      byte[] hash=MessageDigest.getInstance("SHA-256").digest(bytes);
      return new Key(HexFormat.of().formatHex(hash,0,8),new SecretKeySpec(bytes,"AES"));
    }catch(Exception e){throw new IllegalStateException("BFF key ID generation failed",e);}
  }
  BffKeyring(String active,String previousCsv) {
    List<Key> loaded=new ArrayList<>();
    loaded.add(parse(active));
    if(previousCsv!=null&&!previousCsv.isBlank()){
      String[] old=previousCsv.split(",",-1);
      if(old.length>3)throw new IllegalStateException("Too many retired BFF keys");
      for(String value:old)loaded.add(parse(value.trim()));
    }
    if(loaded.stream().map(Key::tag).distinct().count()!=loaded.size())
      throw new IllegalStateException("Duplicate BFF keys");
    keys=List.copyOf(loaded);
  }
  String encrypt(String data){
    try{
      byte[] iv=new byte[12];random.nextBytes(iv);
      Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(Cipher.ENCRYPT_MODE,keys.get(0).aes(),new GCMParameterSpec(128,iv));
      byte[] ciphertext=cipher.doFinal(data.getBytes(StandardCharsets.UTF_8));
      byte[] combined=new byte[iv.length+ciphertext.length];
      System.arraycopy(iv,0,combined,0,iv.length);
      System.arraycopy(ciphertext,0,combined,iv.length,ciphertext.length);
      return "v1:"+keys.get(0).tag()+":"+
        Base64.getUrlEncoder().withoutPadding().encodeToString(combined);
    }catch(Exception e){throw new IllegalStateException("Cannot protect BFF session",e);}
  }
  private static String decryptWith(Key candidate,byte[] bytes)throws Exception{
    if(bytes.length<29||bytes.length>20000)throw new IllegalArgumentException("Invalid BFF payload length");
    Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(Cipher.DECRYPT_MODE,candidate.aes(),new GCMParameterSpec(128,bytes,0,12));
    return new String(cipher.doFinal(bytes,12,bytes.length-12),StandardCharsets.UTF_8);
  }
  String decrypt(String text)throws Exception{
    if(text==null||text.length()>28000)throw new IllegalArgumentException("Invalid BFF ciphertext");
    if(text.startsWith("v1:")){
      if(!text.matches("v1:[a-f0-9]{16}:[A-Za-z0-9_-]+"))
        throw new IllegalArgumentException("Invalid BFF envelope");
      String[] parts=text.split(":",3);
      Key candidate=keys.stream().filter(k->k.tag().equals(parts[1])).findFirst()
        .orElseThrow(()->new IllegalArgumentException("Retired key unavailable"));
      return decryptWith(candidate,Base64.getUrlDecoder().decode(parts[2]));
    }
    // Legacy sessions minted before key versioning are tried against all keys.
    if(!text.matches("[A-Za-z0-9_-]+"))throw new IllegalArgumentException("Invalid legacy BFF envelope");
    byte[] raw=Base64.getUrlDecoder().decode(text);
    for(Key candidate:keys){
      try{return decryptWith(candidate,raw);}catch(Exception ignored){}
    }
    throw new IllegalArgumentException("BFF payload cannot be decrypted");
  }
}
