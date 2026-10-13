package dev.protocolia.domain;

import java.time.OffsetDateTime;
import java.util.List;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** Human-owned domain implementation. The ProtocolIA contract never generates business SQL. */
@Service
public class ToolInventory {
    public record Entry(String code,String name,int quantity,OffsetDateTime lastReviewedAt){}
    public record Page(List<Entry> items,int limit,int offset,int total){}
    private final JdbcTemplate jdbc;
    public ToolInventory(JdbcTemplate jdbc){this.jdbc=jdbc;}
    private static final org.springframework.jdbc.core.RowMapper<Entry> ROW=(rs,i)->
        new Entry(rs.getString("code"),rs.getString("name"),rs.getInt("quantity"),
                  rs.getObject("last_reviewed_at",OffsetDateTime.class));

    private static String validName(String name){
        if(name==null || name.isBlank() || name.length()>255)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"invalid tool name");
        return name.trim();
    }
    private static String validCode(String code){
        if(code==null || code.isBlank() || code.length()>64)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"invalid tool code");
        return code.trim();
    }
    @Transactional
    public Entry create(String code,String name,Integer quantity,OffsetDateTime lastReviewedAt){
        code=validCode(code);
        name=validName(name);
        if(quantity==null || quantity<0)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"invalid quantity");
        try {
            jdbc.update("INSERT INTO tools(code,name,quantity,last_reviewed_at) VALUES(?,?,?,?)",
                        code,name,quantity,lastReviewedAt);
        }catch(DuplicateKeyException e){
            throw new ResponseStatusException(HttpStatus.CONFLICT,"duplicate tool code",e);
        }
        return new Entry(code,name,quantity,lastReviewedAt);
    }
    @Transactional(readOnly=true)
    public Entry get(String code){
        List<Entry> result=jdbc.query(
            "SELECT code,name,quantity,last_reviewed_at FROM tools WHERE code=?",ROW,code);
        if(result.isEmpty())throw new ResponseStatusException(HttpStatus.NOT_FOUND,"tool not found");
        return result.getFirst();
    }
    @Transactional
    public Entry increase(String code,Integer amount){
        if(amount==null || amount<1 || amount>1000)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"invalid quantity increment");
        int updated=jdbc.update(
            "UPDATE tools SET quantity=quantity+? WHERE code=? AND quantity<=?",
            amount,code,Integer.MAX_VALUE-amount);
        if(updated==0){
            if(jdbc.query("SELECT code FROM tools WHERE code=?",(rs,i)->rs.getString(1),code).isEmpty())
                throw new ResponseStatusException(HttpStatus.NOT_FOUND,"tool not found");
            throw new ResponseStatusException(HttpStatus.CONFLICT,"quantity overflow");
        }
        return get(code);
    }
    @Transactional
    public Entry rename(String code,String name){
        name=validName(name);
        if(jdbc.update("UPDATE tools SET name=? WHERE code=?",name,code)==0)
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,"tool not found");
        return get(code);
    }
    @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
    public Page list(Integer limit,Integer offset){
        if(limit==null || limit<1 || limit>50 || offset==null || offset<0 || offset>1000000)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"invalid paging");
        Long total=jdbc.queryForObject("SELECT count(*) FROM tools",Long.class);
        return new Page(jdbc.query(
            "SELECT code,name,quantity,last_reviewed_at FROM tools ORDER BY code LIMIT ? OFFSET ?",
            ROW,limit,offset),limit,offset,Math.toIntExact(total==null?0L:total));
    }
}
