package dev.protocolia.generated;
@org.springframework.web.bind.annotation.RestController
public class ContractController {
    @org.springframework.security.access.prepost.PreAuthorize("hasAuthority('catalog.write')")
    @org.springframework.web.bind.annotation.RequestMapping(path="/api/books",method=org.springframework.web.bind.annotation.RequestMethod.POST)
    public Book createBook(@jakarta.validation.Valid @org.springframework.web.bind.annotation.RequestBody BookRequest body) {
        throw new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.NOT_IMPLEMENTED,"business handler missing");
    }

    @org.springframework.security.access.prepost.PreAuthorize("hasAuthority('catalog.read')")
    @org.springframework.web.bind.annotation.RequestMapping(path="/api/books/{isbn}",method=org.springframework.web.bind.annotation.RequestMethod.GET)
    public Book getBook(@org.springframework.web.bind.annotation.PathVariable("isbn") String isbn) {
        throw new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.NOT_IMPLEMENTED,"business handler missing");
    }

    @org.springframework.web.bind.annotation.RequestMapping(path="/health",method=org.springframework.web.bind.annotation.RequestMethod.GET)
    public Health health() {
        throw new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.NOT_IMPLEMENTED,"business handler missing");
    }
}
