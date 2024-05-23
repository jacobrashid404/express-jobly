import db from "../db.js";
import { BadRequestError, NotFoundError} from "../expressError.js";
import { sqlForPartialUpdate } from "../helpers/sql.js";

/** Related functions for companies. */

class Company {
  /** Create a company (from data), update db, return new company data.
   *
   * data should be { handle, name, description, numEmployees, logoUrl }
   *
   * Returns { handle, name, description, numEmployees, logoUrl }
   *
   * Throws BadRequestError if company already in database.
   * */

  static async create({ handle, name, description, numEmployees, logoUrl }) {
    const duplicateCheck = await db.query(`
        SELECT handle
        FROM companies
        WHERE handle = $1`, [handle]);

    if (duplicateCheck.rows[0])
      throw new BadRequestError(`Duplicate company: ${handle}`);

    const result = await db.query(`
                INSERT INTO companies (handle,
                                       name,
                                       description,
                                       num_employees,
                                       logo_url)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING
                    handle,
                    name,
                    description,
                    num_employees AS "numEmployees",
                    logo_url AS "logoUrl"`, [
          handle,
          name,
          description,
          numEmployees,
          logoUrl,
        ],
    );
    const company = result.rows[0];

    return company;
  }

  /** Find all companies.
   *
   * Returns [{ handle, name, description, numEmployees, logoUrl }, ...]
   * */

  static async findAll() {
    const companiesRes = await db.query(`
        SELECT handle,
               name,
               description,
               num_employees AS "numEmployees",
               logo_url      AS "logoUrl"
        FROM companies
        ORDER BY name`);
    return companiesRes.rows;
  }

  /** Find companies by search parameters
   *  Accepts: {nameLike, minEmployees, maxEmployees} => {"net", 5, 20}
   *    nameLike: string, case-insensitive for search
   *    minEmployees: integer, minimum employee count for search (inclusive)
   *    maxEmployees: integer, maximum employee count for search (inclusive)
   *      All keys optional, must accept at least one
   *      Throws BadRequestError if no keys are included or
   *      if minEmployees > maxEmployees
   *
   *      minEmployees and maxEmployees must be 0 or greater
   *
   *  Returns:
   *    [{ handle, name, description, numEmployees, logoUrl, jobs }, ...]
   *    for each company that matches search parameters
   */

  static async findBySearch({nameLike, minEmployees, maxEmployees}) {
    if(nameLike === undefined && minEmployees === undefined && maxEmployees === undefined) {
      throw new BadRequestError("No parameters included");
    }
    else if (minEmployees > maxEmployees) {
      throw new BadRequestError("min employees must be less than max employees");
    }
    else if(minEmployees < 0 || maxEmployees < 0) {
      throw new BadRequestError("min and max employees must be 0 or greater");
    }

    let baseQuery =`
        SELECT handle,
               name,
               description,
               num_employees AS "numEmployees",
               logo_url      AS "logoUrl"
        FROM companies
        WHERE
        `;

    let parameterIdx = 1;
    const queryArguments = [];

    if (nameLike !== undefined) {
      const nameSearchArg = `%${nameLike}%`;
      queryArguments.push(nameSearchArg);
      const nameSearchQuery = ` name ILIKE $${parameterIdx++}`;
      baseQuery += nameSearchQuery;
    }

    if (minEmployees !== undefined) {
      queryArguments.push(minEmployees);
      const minEmployeesQuery =
        (parameterIdx > 1)
          ? ` AND num_employees >= $${parameterIdx++}`
          : ` num_employees >= $${parameterIdx++}`;

      baseQuery += minEmployeesQuery;
    }

    if (maxEmployees !== undefined) {
      queryArguments.push(maxEmployees);
      const maxEmployeesQuery =
        (parameterIdx > 1)
          ? ` AND num_employees <= $${parameterIdx++}`
          : ` num_employees <= $${parameterIdx++}`;

      baseQuery += maxEmployeesQuery;
    }

    const orderByQuery = ` ORDER BY name, num_employees`;
    const fullQuery = baseQuery + orderByQuery;

    const companies = await db.query(
      fullQuery, queryArguments)

    return companies.rows;
  }

  /** get Where clause for findBySearch method
   *
   * Criteria will be an object with either 1 to 3 key/value pairs.
   * => {nameLike, minEmployees, maxEmployees}
   *
   * Returns:
   * {
   *  whereClause:`name ILIKE '%$1%'
   *               AND num_employees >= $2
   *               AND num_employees <= $3`,
   *  values: ["net", 5, 20]
   * }
  */

  static _getWhereClause(criteria){
    const {nameLike, minEmployees, maxEmployees} = criteria;
    if(
      nameLike === undefined &&
      minEmployees === undefined &&
      maxEmployees === undefined) {
      throw new BadRequestError("No parameters included");
    }
    if (minEmployees > maxEmployees) {
      throw new BadRequestError("minEmployees must be less than maxEmployees");
    }
    if(minEmployees < 0 || maxEmployees < 0) {
      throw new BadRequestError("min and max employees must be 0 or greater");
    }

    const criterias = Object.keys(criteria);

    const seperateWhereClause = criterias.map(function (colName, idx){
      if(colName === "nameLike"){
        return `name ILIKE '%$${idx + 1}%'`
      }
      if(colName === "minEmployees"){
        return `num_employees >= $${idx + 1}`
      }
      if(colName === "maxEmployees"){
        return `num_employees <= $${idx + 1}`
      }
    });

    const whereClause = seperateWhereClause.join(" AND ")

    return {
      whereClause,
      values: Object.values(criteria)
    }
  }

  /** Given a company handle, return data about company.
   *
   * Returns { handle, name, description, numEmployees, logoUrl, jobs }
   *   where jobs is [{ id, title, salary, equity, companyHandle }, ...]
   *
   * Throws NotFoundError if not found.
   **/

  static async get(handle) {
    const companyRes = await db.query(`
        SELECT handle,
               name,
               description,
               num_employees AS "numEmployees",
               logo_url      AS "logoUrl"
        FROM companies
        WHERE handle = $1`, [handle]);

    const company = companyRes.rows[0];

    if (!company) throw new NotFoundError(`No company: ${handle}`);

    return company;
  }

  /** Update company data with `data`.
   *
   * This is a "partial update" --- it's fine if data doesn't contain all the
   * fields; this only changes provided ones.
   *
   * Data can include: {name, description, numEmployees, logoUrl}
   *
   * Returns {handle, name, description, numEmployees, logoUrl}
   *
   * Throws NotFoundError if not found.
   */

  static async update(handle, data) {
    const { setCols, values } = sqlForPartialUpdate(
        data,
        {
          numEmployees: "num_employees",
          logoUrl: "logo_url",
        });
    const handleVarIdx = "$" + (values.length + 1);

    const querySql = `
        UPDATE companies
        SET ${setCols}
        WHERE handle = ${handleVarIdx}
        RETURNING
            handle,
            name,
            description,
            num_employees AS "numEmployees",
            logo_url AS "logoUrl"`;
    const result = await db.query(querySql, [...values, handle]);
    const company = result.rows[0];

    if (!company) throw new NotFoundError(`No company: ${handle}`);

    return company;
  }

  /** Delete given company from database; returns undefined.
   *
   * Throws NotFoundError if company not found.
   **/

  static async remove(handle) {
    const result = await db.query(`
        DELETE
        FROM companies
        WHERE handle = $1
        RETURNING handle`, [handle]);
    const company = result.rows[0];

    if (!company) throw new NotFoundError(`No company: ${handle}`);
  }
}


export default Company;